const fetch = require("node-fetch");

const SHOPIFY_STORE = "shop-globalstone.myshopify.com";

const FORECASTING_API_URL = "https://forecastingapi.worldofstones.in/api/getFreeStock";
const LOCATION_ID = "gid://shopify/Location/85832237378";

// **1️⃣ Fetch Active Products from Shopify**
async function fetchAllInventory(cursor = null, inventoryData = []) {
  const query = `
    query ($cursor: String) {
      products(first: 50, after: $cursor, query: "status:active") {
        edges {
          node {
            id
            title
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }`;

  const response = await fetch(
    `https://${SHOPIFY_STORE}/admin/api/2025-01/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables: { cursor } }),
    }
  );

  const data = await response.json();
  if (!data?.data?.products) return inventoryData;

  const newInventory = data.data.products.edges.flatMap((edge) =>
    edge.node.variants.edges
      .map((variantEdge) => ({
        productId: edge.node.id,
        productTitle: edge.node.title,
        variantId: variantEdge.node.id,
        sku: variantEdge.node.sku?.trim() || null,
        inventoryItemId: variantEdge.node.inventoryItem?.id || null,
      }))
      .filter((variant) => variant.sku)
  );

  inventoryData.push(...newInventory);

  if (data.data.products.pageInfo.hasNextPage) {
    return fetchAllInventory(data.data.products.pageInfo.endCursor, inventoryData);
  }

  return inventoryData;
}

// **2️⃣ Fetch Stock Levels from Forecasting API**
async function fetchStockLevels(skus) {
  if (skus.length === 0) {
    console.log("No SKUs to send.");
    return {};
  }

  try {
    const response = await fetch(FORECASTING_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sku: skus.join(",") }),
    });

    const responseData = await response.json();
    console.log("Forecasting API Stock Data:", responseData);
    return responseData;
  } catch (error) {
    console.error("Error fetching stock levels:", error);
    return {};
  }
}

// **4️⃣ Update Shopify Inventory with Correct Stock**
async function updateShopifyInventory(inventoryUpdates) {
  if (inventoryUpdates.length === 0) {
    console.log("No inventory updates to apply.");
    return;
  }

  for (const { inventoryItemId, availableStock } of inventoryUpdates) {
    const url = `https://${SHOPIFY_STORE}/admin/api/2025-01/inventory_levels/set.json`;

    const payload = {
      location_id: LOCATION_ID.split("/").pop(), // Extract numeric ID from GID
      inventory_item_id: inventoryItemId.split("/").pop(), // Extract numeric ID from GID
      available: availableStock, // Set the exact stock level
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": ACCESS_TOKEN,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (response.ok) {
        console.log(`✅ Successfully updated inventory for item ${inventoryItemId}.`);
      } else {
        console.error("❌ Error updating inventory:", JSON.stringify(data, null, 2));
      }
    } catch (error) {
      console.error("❌ Error in inventory update request:", error);
    }
  }
}


// **🚀 Run Full Process**
async function syncInventory() {
  console.log("Fetching all active products & SKUs...");
  const inventoryItems = await fetchAllInventory();
  console.log(`Fetched ${inventoryItems.length} active product variants with valid SKUs.`);

  const skus = inventoryItems.map((item) => item.sku);
  console.log(`Fetching stock levels for ${skus.length} SKUs...`);

  const stockData = await fetchStockLevels(skus);

  const inventoryItemIds = inventoryItems.map(({ inventoryItemId }) => inventoryItemId);

  console.log("Updating inventory with correct stock levels...");
  const inventoryUpdates = inventoryItems
    .map(({ inventoryItemId, sku }) => ({
      inventoryItemId,
      availableStock: stockData[sku] || 0,
    }))
    .filter(({ availableStock }) => availableStock !== null);

  await updateShopifyInventory(inventoryUpdates);
}

// **Start Sync Process**
syncInventory().catch(console.error);
