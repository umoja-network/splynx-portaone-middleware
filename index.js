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

// Customer Status Logic
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
        `SUCCESS: ${action.toUpperCase()} succeeded for i_account ${i_account}`
      );
      return true;

    } catch (err) {
      console.error(
        `PORTAONE ERROR (attempt ${attempt}) for ${i_account}:`,
        err.message || err.response?.data
      );

      if (attempt < 3) {
        const delay = 1000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  console.error(`❌ FAILED: All retries failed for i_account ${i_account}`);
  return false;
}

// --------------- WEBHOOK HANDLER ---------------
app.post("/splynx-webhook", async (req, res) => {
  
  if (req.body.type === "ping") {
    return res.json({ success: true });
  }

  const data = req.body.data || {};
  const attributes = data.attributes || {};
  const extra = data.attributes_additional || {};
  const changed = data.changed_attributes || {};

  const customerId = data.customer_id || attributes.id;

  if (!customerId) {
    console.error("WEBHOOK ERROR: Missing customer_id");
    return res.status(400).json({ error: "Missing customer_id" });
  }

  // Determine which fields changed
  const mainStatusChanged = !!changed.status;
  const simStatusChanged = !!changed.sim_status;

  if (!mainStatusChanged && !simStatusChanged) {
    return res.json({ ignored: true });
  }

  const mainStatus = (attributes.status || "").toLowerCase();
  const simStatus = (extra.sim_status || "").toLowerCase();

  // Skip empty sim status (silent)
  if (!simStatus || simStatus.trim() === "") {
    return res.json({
      skipped: true,
      reason: "Sim status empty",
    });
  }

  // -------------------- DECISION LOGIC --------------------
  let action = null;

  if (STATUS_BLOCK.includes(mainStatus)) {
    action = "block";
  } else if (STATUS_UNBLOCK.includes(mainStatus)) {
    action = "unblock";
  } else {
    console.error(
      `STATUS MAPPING ERROR: Unknown main status '${mainStatus}' for customer ${customerId}`
    );
    return res.json({ error: "Unknown status mapping" });
  }

  // Respond immediately
  res.json({ success: true, action_taken: action });

  // Background async processing
  (async () => {
    const i_account = await getMsisdnIdByCustomerId(customerId);

    if (!i_account) {
      console.error(
        `INVENTORY ERROR: No i_account found for customer ${customerId}`
      );
      return;
    }

    await blockUnblockSim(i_account, action);
  })();
});

// --------------- START SERVER ---------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Middleware running on port ${PORT}`)
);
