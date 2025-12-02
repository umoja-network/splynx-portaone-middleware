const express = require("express");
const axios = require("axios");
const https = require("https");
require("dotenv").config();

const app = express();

// --------------------
// PARSE WEBHOOK BODY
// --------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// --------------------
// CONFIG
// --------------------
const PORTAONE_API_URL = process.env.PORTAONE_API_URL;
const PORTAONE_API_KEY = process.env.PORTAONE_API_KEY;

const SPLYNX_INV_URL =
    "https://portal.umoja.network/api/2.0/admin/inventory/items";

const SPLYNX_AUTH =
    "Basic NGQwNzQwZGE2NjFjYjRlYTQzMjM2NmM5MGZhZGUxOWU6MmE0ZDkzOGVkNTYyMjg5MmExNDdmMjZjMmVlNTI2MmI=";

// Accepted status mapping
const STATUS_BLOCK = ["new", "blocked", "inactive"];
const STATUS_UNBLOCK = ["active"];

// Accept PortaOne self-signed cert
const portaOneAgent = new https.Agent({ rejectUnauthorized: false });

// --------------------
// FETCH i_account FROM INVENTORY
// --------------------
async function getMsisdnId(customerId) {
    try {
        console.log("INVENTORY: Fetching items from Splynx...");

        const response = await axios.get(SPLYNX_INV_URL, {
            headers: {
                Authorization: SPLYNX_AUTH,
                "Content-Type": "application/json",
            },
            timeout: 15000,
        });

        const items = response.data || [];
        console.log(`INVENTORY: ${items.length} items fetched`);

        // Filter by customer + product_id = 5
        const match = items.find(
            (item) =>
                Number(item.customer_id) === Number(customerId) &&
                Number(item.product_id) === 5
        );

        if (!match) {
            console.log(
                `INVENTORY: No match for customer_id=${customerId} AND product_id=5`
            );
            return null;
        }

        const i_account = match.additional_attributes?.msisdn_id;
        return i_account || null;
    } catch (err) {
        console.error("INVENTORY ERROR:", err.response?.data || err.message);
        return null;
    }
}

// --------------------
// BLOCK / UNBLOCK SIM (PortaOne)
// --------------------
async function blockUnblockSim(i_account, action) {
    try {
        const blocked = action === "block" ? "Y" : "N";

        const payload = {
            params: {
                account_info: {
                    i_account: Number(i_account),
                    blocked,
                },
            },
        };

        console.log("PORTAONE → Sending payload:", payload);

        const response = await axios.post(
            `${PORTAONE_API_URL}/Account/update_account`,
            payload,
            {
                headers: {
                    Authorization: `Bearer ${PORTAONE_API_KEY}`,
                    "Content-Type": "application/json",
                },
                httpsAgent: portaOneAgent,
                timeout: 15000,
            }
        );

        console.log(
            `PORTAONE: ${action.toUpperCase()} successful for i_account ${i_account}`
        );

        return response.data;
    } catch (err) {
        console.error(
            "PORTAONE ERROR:",
            err.response?.data || err.message
        );
        return null;
    }
}

// --------------------
// WEBHOOK ENDPOINT
// --------------------
app.post("/splynx-webhook", async (req, res) => {
    console.log("WEBHOOK RAW:", req.body);

    // Handle Splynx webhook test
    if (req.body.type === "ping") {
        console.log("WEBHOOK: Splynx ping received");
        return res.json({ success: true });
    }

    // Splynx sends: { data: { attributes: { id, status } } }
    const customerId =
        req.body.data?.attributes?.id ||
        req.body.customer_id ||
        req.body.id;

    const status =
        req.body.data?.attributes?.status ||
        req.body.status ||
        req.body.customer_status;

    if (!customerId || !status) {
        console.log(
            "WEBHOOK ERROR: Missing customer id or status"
        );
        return res
            .status(400)
            .json({ error: "customer_id and status required" });
    }

    const normalizedStatus = status.toLowerCase();

    console.log(
        `WEBHOOK: Parsed → customer_id=${customerId}, status=${normalizedStatus}`
    );

    // Respond to Splynx instantly
    res.json({ success: true });

    // Continue processing async
    (async () => {
        const i_account = await getMsisdnId(customerId);

        if (!i_account) {
            console.log(
                `INVENTORY: No i_account found for customer_id ${customerId}`
            );
            return;
        }

        console.log(`INVENTORY: Found i_account = ${i_account}`);

        if (STATUS_BLOCK.includes(normalizedStatus)) {
            await blockUnblockSim(i_account, "block");
        } else if (STATUS_UNBLOCK.includes(normalizedStatus)) {
            await blockUnblockSim(i_account, "unblock");
        } else {
            console.log(
                `WEBHOOK: Status "${normalizedStatus}" ignored — no action taken`
            );
        }
    })();
});

// --------------------
// START SERVER
// --------------------
app.listen(5000, () =>
    console.log(
        "✅ Middleware running on port 5000 — Ready to receive Splynx webhooks"
    )
);
