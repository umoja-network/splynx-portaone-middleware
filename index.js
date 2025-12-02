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
const STATUS_BLOCK = ["New", "Blocked", "Inactive"];
const STATUS_UNBLOCK = ["Active"];

// -------------------------------------------------------
// STEP 1: GET msisdn_id FROM INVENTORY BY customer_id
// -------------------------------------------------------
async function getMsisdnIdByCustomerId(customerId) {
    try {
        const response = await axios.get(SPLYNX_INV_URL, {
            headers: {
                "Authorization": SPLYNX_AUTH,
                "Content-Type": "application/json"
            }
        });

        const items = response.data || [];

        // Filter inventory items where customer_id matches
        const match = items.find(
            item => item.customer_id && Number(item.customer_id) === Number(customerId)
        );

        if (!match) {
            console.log(`No inventory item found for customer_id ${customerId}`);
            return null;
        }

        // Return msisdn_id from additional attributes
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
                    account_info: {
                        i_account,
                        blocked
                    }
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
    const { customer_id, status } = req.body;

    if (!customer_id || !status) {
        return res.status(400).json({ error: "customer_id and status required" });
    }

    console.log(`Webhook received → customer=${customer_id}, status=${status}`);

    // Get msisdn_id = PortaOne i_account
    const i_account = await getMsisdnIdByCustomerId(customer_id);

    if (!i_account) {
        console.log("No msisdn_id found in inventory. Cannot proceed");
        return res.json({ success: false });
    }

    console.log(`Found i_account from inventory: ${i_account}`);

    // Block/Unblock
    if (STATUS_BLOCK.includes(status)) {
        await blockUnblockSim(i_account, "block");
    } else if (STATUS_UNBLOCK.includes(status)) {
        await blockUnblockSim(i_account, "unblock");
    } else {
        console.log("Unknown status — no action");
    }

    res.json({ success: true });
});

// Start server
app.listen(5000, () => console.log("Middleware running on port 5000"));
