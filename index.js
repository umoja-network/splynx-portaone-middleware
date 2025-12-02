const express = require("express");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

const app = express();

// --------------------
// PARSE INCOMING WEBHOOKS
// --------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --------------------
// CONFIG
// --------------------
const PORTAONE_API_URL = process.env.PORTAONE_API_URL;
const PORTAONE_API_KEY = process.env.PORTAONE_API_KEY;

const SPLYNX_INV_URL = "https://portal.umoja.network/api/2.0/admin/inventory/items";
const SPLYNX_AUTH = "Basic NGQwNzQwZGE2NjFjYjRlYTQzMjM2NmM5MGZhZGUxOWU6MmE0ZDkzOGVkNTYyMjg5MmExNDdmMjZjMmVlNTI2MmI=";

const STATUS_BLOCK = ["blocked"];
const STATUS_UNBLOCK = ["active"];

// HTTPS agent for PortaOne self-signed certs
const portaOneAgent = new https.Agent({ rejectUnauthorized: false });

// --------------------
// GET i_account FROM INVENTORY (product_id = 5)
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

        // Find inventory item for this customer with product_id = 5
        const match = items.find(
            item => Number(item.customer_id) === Number(customerId) && Number(item.product_id) === 5
        );

        if (!match) {
            console.log(`INVENTORY: No product_id=5 found for customer_id ${customerId}`);
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
    const data = req.body.data || {};
    const attributes = data.attributes || {};
    const attributesAdditional = data.attributes_additional || {};

    // Extract customer_id
    const customerId = data.customer_id || attributes.id;

    // Extract sim status
    let statusRaw = (attributes.status || attributesAdditional.sim_status || '').toLowerCase();
    let status;
    if (statusRaw.includes('blocked')) status = 'blocked';
    else if (statusRaw.includes('not blocked') || statusRaw.includes('active')) status = 'active';

    console.log(`WEBHOOK: customer_id=${customerId}, status=${status}`);
    console.log("WEBHOOK: RAW payload received:", req.body);

    if (!customerId || !status) {
        console.log("WEBHOOK ERROR: cannot extract customer_id or status");
        return res.status(400).json({ error: "Missing customer_id or status" });
    }

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
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Middleware running on port ${PORT} — ready to receive webhooks`));
