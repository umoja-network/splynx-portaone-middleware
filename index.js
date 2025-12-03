const express = require("express");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

const app = express();

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// -------------------- CONFIG --------------------
const PORTAONE_API_URL = process.env.PORTAONE_API_URL;
const PORTAONE_API_KEY = process.env.PORTAONE_API_KEY;

const SPLYNX_INV_URL =
  "https://portal.umoja.network/api/2.0/admin/inventory/items";

const SPLYNX_AUTH =
  "Basic NGQwNzQwZGE2NjFjYjRlYTQzMjM2NmM5MGZhZGUxOWU6MmE0ZDkzOGVkNTYyMjg5MmExNDdmMjZjMmVlNTI2MmI=";

const portaOneAgent = new https.Agent({ rejectUnauthorized: false });

const STATUS_BLOCK = ["blocked", "sim blocked", "new", "inactive"];
const STATUS_UNBLOCK = ["active", "sim not blocked"];

// --------------- Inventory lookup ---------------
async function getMsisdnIdByCustomerId(customerId) {
  try {
    const response = await axios.get(SPLYNX_INV_URL, {
      headers: { Authorization: SPLYNX_AUTH },
      timeout: 10000,
    });

    const items = response.data || [];

    const match = items.find(
      (item) =>
        Number(item.customer_id) === Number(customerId) &&
        Number(item.product_id) === 5
    );

    if (!match) return null;

    return match.additional_attributes?.msisdn_id || null;
  } catch (err) {
    console.error("INVENTORY ERROR:", err.message);
    return null;
  }
}

// --------------- PortaOne block/unblock (WITH RETRY) ---------------
async function blockUnblockSim(i_account, action) {
  const blocked = action === "block" ? "Y" : "N";

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`PORTAONE: Attempt ${attempt} for i_account ${i_account}`);

      await axios.post(
        `${PORTAONE_API_URL}/Account/update_account`,
        {
          params: { account_info: { i_account, blocked } },
        },
        {
          headers: {
            Authorization: `Bearer ${PORTAONE_API_KEY}`,
            "Content-Type": "application/json",
          },
          httpsAgent: portaOneAgent,
          timeout: 8000,
        }
      );

      console.log(
        `PORTAONE: ${action.toUpperCase()} succeeded for ${i_account}`
      );
      return true;
    } catch (err) {
      console.error(
        `PORTAONE ERROR (attempt ${attempt}):`,
        err.message || err.response?.data
      );

      if (attempt < 3) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        console.log(`Retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error(
    `❌ PORTAONE: All retries failed for i_account ${i_account}`
  );
  return false;
}

// --------------- WEBHOOK HANDLER ---------------
// --------------- WEBHOOK HANDLER ---------------
app.post("/splynx-webhook", async (req, res) => {
  console.log("WEBHOOK: Payload received");

  if (req.body.type === "ping") {
    return res.json({ success: true });
  }

  const data = req.body.data || {};
  const attributes = data.attributes || {};
  const extra = data.attributes_additional || {};
  const changed = data.changed_attributes || {};

  // Extract customer_id
  const customerId = data.customer_id || attributes.id;

  if (!customerId) {
    console.log("WEBHOOK ERROR: Missing customer_id");
    return res.status(400).json({ error: "Missing customer_id" });
  }

  // 1. Check if RELEVANT fields changed
  // We proceed if 'status' changed OR 'sim_status' changed
  const mainStatusChanged = !!changed.status;
  // Note: Check the exact key name Splynx uses for custom field changes in your specific version logs. 
  // It is usually the field name (e.g., 'sim_status').
  const simStatusChanged = !!changed.sim_status; 

  if (!mainStatusChanged && !simStatusChanged) {
    console.log(`IGNORED: Neither 'status' nor 'sim_status' changed for ID ${customerId}`);
    return res.json({ ignored: true });
  }

  // 2. Determine EFFECTIVE Status
  const mainStatus = (attributes.status || "").toLowerCase();
  const simStatus = (extra.sim_status || "").toLowerCase();

  let action = null; // 'block' or 'unblock'

  // LOGIC: Main Status overrides everything if blocked. 
  // If Main is active, Sim Status takes over.
  
  if (STATUS_BLOCK.includes(mainStatus)) {
    // If Customer is Inactive/Blocked -> BLOCK SIM
    action = "block";
    console.log(`DECISION: Customer Status is '${mainStatus}' -> BLOCKING`);
  } 
  else if (STATUS_UNBLOCK.includes(mainStatus)) {
    // Customer is Active, now check the specific SIM field
    if (STATUS_BLOCK.includes(simStatus)) {
      action = "block";
      console.log(`DECISION: Customer is Active but Sim Status is '${simStatus}' -> BLOCKING`);
    } else {
      action = "unblock";
      console.log(`DECISION: Customer is Active and Sim Status is '${simStatus}' -> UNBLOCKING`);
    }
  }

  if (!action) {
    console.log(`WEBHOOK ERROR: Could not determine action from Status: '${mainStatus}' / Sim: '${simStatus}'`);
    // Return success to Splynx so it stops retrying, but log the error
    return res.json({ error: "Unknown status mapping" });
  }

  // Send immediate response to Splynx
  res.json({ success: true, action_taken: action });

  // 3. Execute Async Logic
  (async () => {
    const i_account = await getMsisdnIdByCustomerId(customerId);

    if (!i_account) {
      console.log(`INVENTORY: No i_account found for customer ${customerId}`);
      return;
    }

    console.log(`EXECUTING: ${action.toUpperCase()} for i_account ${i_account}`);
    await blockUnblockSim(i_account, action);
  })();
});
// --------------- START SERVER ---------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Middleware running on port ${PORT} — ready`)
);
