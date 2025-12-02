const express = require("express");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔧 CONFIG
const PORTAONE_API_URL = process.env.PORTAONE_API_URL;
const PORTAONE_API_KEY = process.env.PORTAONE_API_KEY;

const SPLYNX_INV_URL = "https://portal.umoja.network/api/2.0/admin/inventory/items";
const SPLYNX_AUTH =
  "Basic NGQwNzQwZGE2NjFjYjRlYTQzMjM2NmM5MGZhZGUxOWU6MmE0ZDkzOGVkNTYyMjg5MmExNDdmMjZjMmVlNTI2MmI=";

const STATUS_BLOCK = ["blocked", "inactive", "new"];
const STATUS_UNBLOCK = ["active"];

const portaOneAgent = new https.Agent({ rejectUnauthorized: false });


// 🔍 GET i_account FROM INVENTORY
async function getMsisdnIdByCustomerId(customerId) {
  try {
    console.log("INVENTORY: Fetching items from Splynx...");
    const response = await axios.get(SPLYNX_INV_URL, {
      headers: { Authorization: SPLYNX_AUTH },
      timeout: 10000,
    });

    const items = response.data || [];
    console.log(`INVENTORY: ${items.length} items fetched`);

    const match = items.find(
      (item) =>
        Number(item.customer_id) === Number(customerId) &&
        Number(item.product_id) === 5
    );

    if (!match) {
      console.log(`INVENTORY: No item found for customer_id ${customerId}`);
      return null;
    }

    return match.additional_attributes?.msisdn_id || null;
  } catch (err) {
    console.error("INVENTORY ERROR:", err.response?.data || err.message);
    return null;
  }
}


// 🔌 BLOCK / UNBLOCK
async function blockUnblockSim(i_account, action) {
  try {
    const blocked = action === "block" ? "Y" : "N";

    const response = await axios.post(
      `${PORTAONE_API_URL}/Account/update_account`,
      {
        params: {
          account_info: { i_account, blocked },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${PORTAONE_API_KEY}`,
          "Content-Type": "application/json",
        },
        httpsAgent: portaOneAgent,
      }
    );

    console.log(`PORTAONE: ${action.toUpperCase()} successful for i_account ${i_account}`);
    return response.data;
  } catch (err) {
    console.error("PORTAONE ERROR:", err.response?.data || err.message);
  }
}



// 🔔 WEBHOOK ENDPOINT
app.post("/splynx-webhook", (req, res) => {
  console.log("WEBHOOK RAW:", JSON.stringify(req.body, null, 2));

  // respond instantly so Splynx does NOT timeout
  res.json({ success: true });

  // HANDLE TEST PING
  if (req.body.type === "ping") {
    console.log("Received PING from Splynx");
    return;
  }

  // extract customer_id and status based on real Splynx structure
  const customerId = req.body?.data?.attributes?.id;
  const status = req.body?.data?.attributes?.status?.toLowerCase();

  if (!customerId || !status) {
    console.log("WEBHOOK ERROR: Missing required fields");
    return;
  }

  console.log(`WEBHOOK Parsed → customerId=${customerId}, status=${status}`);

  // async processing
  (async () => {
    const i_account = await getMsisdnIdByCustomerId(customerId);

    if (!i_account) {
      console.log(`No i_account found for customer ${customerId}`);
      return;
    }

    console.log(`Found i_account: ${i_account}`);

    if (STATUS_BLOCK.includes(status)) {
      await blockUnblockSim(i_account, "block");
    } else if (STATUS_UNBLOCK.includes(status)) {
      await blockUnblockSim(i_account, "unblock");
    } else {
      console.log("Webhook status ignored.");
    }
  })();
});


// START SERVER
app.listen(5000, () =>
  console.log("Middleware running on port 5000 and ready for Splynx")
);
