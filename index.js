const express = require("express");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

const app = express();

// --------------------
// PARSE INCOMING WEBHOOKS
// --------------------
// Parse URL-encoded (form) payloads
app.use(express.urlencoded({ extended: true }));
// Parse JSON payloads
app.use(express.json());

// --------------------
// CONFIG
// --------------------
const PORTAONE_API_URL = process.env.PORTAONE_API_URL;
const PORTAONE_API_KEY = process.env.PORTAONE_API_KEY;

const SPLYNX_INV_URL = "https://portal.umoja.network/api/2.0/admin/inventory/items";
const SPLYNX_AUTH = "Basic NGQwNzQwZGE2NjFjYjRlYTQzMjM2NmM5MGZhZGUxOWU6MmE0ZDkzOGVkNTYyMjg5MmExNDdmMjZjMmVlNTI2MmI=";

const STATUS_BLOCK = ["new", "blocked", "inactive"];
const STATUS_UNBLOCK = ["active"];

// HTTPS agent for PortaOne self-signed certs
const portaOneAgent = new https.Agent({ rejectUnauthorized: false });

// --------------------
// GET msisdn_id FROM INVENTORY
// --------------------
async function getMsisdnIdByCustomerId(customerId) {
    try {
        console.log("INVENTORY: Fetching items from Splynx...");
        const response = await axios.get(SPLYNX_INV_URL, {
            headers: { Authorization: SPLYNX_AUTH, "Content-Type": "application/json" },
            timeout: 10000
        });

        const items = response.data || [];
        console.log(`INVENTORY: ${items.length} items fetched`);

        const match = items.find(
            item => item.customer_id && Number(item.customer_id) === Number(customerId)
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

// --------------------
// BLOCK / UNBLOCK SIM USING PORTAONE
// --------------------
async function blockUnblockSim(i_account, action) {
    try {
        const blocked = action === "block" ? "Y" : "N";
        const response = await axios.post(
            `${PORTAONE_API_URL}/Account/update_account`,
            { params: { account_info: { i_account, blocked } } },
            {
                headers: { Authorization: `Bearer ${PORTAONE_API_KEY}`, "Content-Type": "application/json" },
                httpsAgent: portaOneAgent
            }
        );

        console.log(`PORTAONE: ${action.toUpperCase()} successful for i_account ${i_account}`);
        return response.data;
    } catch (err) {
        console.error("PORTAONE ERROR:", err.response?.data || err.message);
    }
}

// --------------------
// WEBHOOK FROM SPLYNX
// --------------------
app.post("/splynx-webhook", async (req, res) => {
    console.log("WEBHOOK: RAW payload received:", req.body);

    // Splynx may send 'id' or 'customer_id'
    const customerId = req.body.customer_id || req.body.id;
    const status = req.body.status?.toLowerCase();

    if (!customerId || !status) {
        console.log("WEBHOOK ERROR: customer_id/id or status missing");
        return res.status(400).json({ error: "customer_id/id and status required" });
    }

    console.log(`WEBHOOK: Parsed → customer_id=${customerId}, status=${status}`);

    // Immediate response to Splynx
    res.json({ success: true });

    // Async processing
    (async () => {
        const i_account = await getMsisdnIdByCustomerId(customerId);

        if (!i_account) {
            console.log(`INVENTORY: No i_account found for customer_id ${customerId}`);
            return;
        }

        console.log(`INVENTORY: Found i_account: ${i_account}`);

        if (STATUS_BLOCK.includes(status)) {
            await blockUnblockSim(i_account, "block");
        } else if (STATUS_UNBLOCK.includes(status)) {
            await blockUnblockSim(i_account, "unblock");
        } else {
            console.log(`WEBHOOK: Status "${status}" ignored — no action`);
        }
    })();
});

// --------------------
// START SERVER
// --------------------
app.listen(5000, () => console.log("✅ Middleware running on port 5000 — ready to receive webhooks"));
