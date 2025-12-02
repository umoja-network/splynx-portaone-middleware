const express = require("express");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// PortaOne API credentials
const PORTAONE_API_URL = process.env.PORTAONE_API_URL;
const PORTAONE_API_KEY = process.env.PORTAONE_API_KEY;

// Splynx Inventory API details
const SPLYNX_INV_URL = "https://portal.umoja.network/api/2.0/admin/inventory/items";
const SPLYNX_AUTH = "Basic NGQwNzQwZGE2NjFjYjRlYTQzMjM2NmM5MGZhZGUxOWU6MmE0ZDkzOGVkNTYyMjg5MmExNDdmMjZjMmVlNTI2MmI=";

// Status mapping
const STATUS_BLOCK = ["new", "blocked", "inactive"];
const STATUS_UNBLOCK = ["active"];

// -------------------------------------------------------
// STEP 1: GET msisdn_id FROM INVENTORY BY customer_id
// -------------------------------------------------------
async function getMsisdnIdByCustomerId(customerId) {
    try {
        console.log("Fetching inventory items from Splynx...");
        const response = await axios.get(SPLYNX_INV_URL, {
            headers: {
                Authorization: SPLYNX_AUTH,
                "Content-Type": "application/json",
            },
            timeout: 10000 // 10 seconds
        });

        const items = response.data || [];
        console.log("Inventory fetched:", items.length, "items");

        const match = items.find(
            item => item.customer_id && Number(item.customer_id) === Number(customerId)
        );

        if (!match) {
            console.log(`No inventory item found for customer_id ${customerId}`);
            return null;
        }

        return match.additional_attributes?.msisdn_id || null;
    } catch (err) {
        console.error("Error fetching inventory:", err.response?.data || err.message);
        return null;
    }
}

// -------------------------------------------------------
// STEP 2: BLOCK / UNBLOCK SIM USING PortaOne
// -------------------------------------------------------
async function blockUnblockSim(i_account, action) {
    try {
        const blocked = action === "block" ? "Y" : "N";

        const response = await axios.post(
            `${PORTAONE_API_URL}/Account/update_account`,
            {
                params: {
                    account_info: { i_account, blocked }
                }
            },
            {
                headers: {
                    Authorization: `Bearer ${PORTAONE_API_KEY}`,
                    "Content-Type": "application/json"
                }
            }
        );

        console.log(`${action.toUpperCase()} successful for i_account ${i_account}`);
        return response.data;
    } catch (err) {
        console.error(`Error updating PortaOne account:`, err.response?.data || err.message);
    }
}

// -------------------------------------------------------
// STEP 3: WEBHOOK FROM SPLYNX
// -------------------------------------------------------
app.post("/splynx-webhook", async (req, res) => {
    console.log("RAW WEBHOOK RECEIVED:", req.body);

    const customerId = req.body.customer_id || req.body.id;
    const status = req.body.status?.toLowerCase();

    if (!customerId || !status) {
        return res.status(400).json({ error: "customer_id/id and status required" });
    }

    console.log(`Webhook parsed → customer_id=${customerId}, status=${status}`);

    // ✅ Immediately respond success so webhook doesn't hang
    res.json({ success: true });

    // Do the inventory lookup and block/unblock asynchronously
    (async () => {
        const i_account = await getMsisdnIdByCustomerId(customerId);

        if (!i_account) {
            console.log(`No i_account found for customer_id ${customerId}`);
            return;
        }

        console.log(`Found i_account: ${i_account}`);

        if (STATUS_BLOCK.includes(status)) {
            await blockUnblockSim(i_account, "block");
        } else if (STATUS_UNBLOCK.includes(status)) {
            await blockUnblockSim(i_account, "unblock");
        } else {
            console.log(`Status "${status}" ignored — no action`);
        }
    })();
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
app.listen(5000, () => console.log("Middleware running on port 5000"));
