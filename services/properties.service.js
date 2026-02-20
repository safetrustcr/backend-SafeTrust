import axios from "axios";

const HASURA_URL = process.env.HASURA_URL;
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

export async function fetchProperties({ type, limit, offset }) {
  try {
    if (!HASURA_URL || !HASURA_ADMIN_SECRET) {
      throw new Error("Hasura environment variables not configured");
    }

    const query = `
      query FetchProperties($limit: Int!, $offset: Int!) {
        apartments(
          where: { available: { _eq: true } }
          limit: $limit
          offset: $offset
        ) {
          id
          name
          price
          city
          created_at
          images(limit: 1) {
            url
          }
        }

        hotels(
          where: { available: { _eq: true } }
          limit: $limit
          offset: $offset
        ) {
          id
          name
          price
          city
          created_at
          images(limit: 1) {
            url
          }
        }
      }
    `;

    const response = await axios.post(
      HASURA_URL,
      {
        query,
        variables: { limit, offset },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
        },
      }
    );

    // 🔎 Check for GraphQL errors
    if (response?.data?.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const apartments = response?.data?.data?.apartments || [];
    const hotels = response?.data?.data?.hotels || [];

    let unified = [];

    if (type === "apartment" || type === "all") {
      unified.push(
        ...apartments.map((a) => ({
          id: a.id,
          type: "apartment",
          name: a.name,
          price: a.price,
          city: a.city,
          image: a.images?.[0]?.url || null,
          created_at: a.created_at,
        }))
      );
    }

    if (type === "hotel" || type === "all") {
      unified.push(
        ...hotels.map((h) => ({
          id: h.id,
          type: "hotel",
          name: h.name,
          price: h.price,
          city: h.city,
          image: h.images?.[0]?.url || null,
          created_at: h.created_at,
        }))
      );
    }

    // Sort newest first
    unified.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    return unified;
  } catch (error) {
    console.error("Hasura fetch error:", error.message);
    throw new Error("Failed to fetch properties from Hasura");
  }
}