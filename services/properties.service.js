import axios from "axios";

export async function fetchProperties({ type, limit, offset }) {
  const HASURA_URL = process.env.HASURA_URL;
  const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

  try {
    // 🔥 If mock mode enabled → skip Hasura entirely
    if (process.env.USE_MOCK_DATA === "true") {
      return generateMockData(type, limit, offset);
    }

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
          images(limit: 1) { url }
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
          images(limit: 1) { url }
        }
      }
    `;

    const response = await axios.post(
      HASURA_URL,
      { query, variables: { limit, offset } },
      {
        headers: {
          "Content-Type": "application/json",
          "x-hasura-admin-secret": HASURA_ADMIN_SECRET,
        },
      }
    );

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

    unified.sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    return unified;
  } catch (error) {
    console.error("Hasura fetch error:", error.message);
    throw new Error("Failed to fetch properties from Hasura");
  }
}

// 🔥 Mock generator function
function generateMockData(type, limit, offset) {
  const mockData = [
    {
      id: "mock-1",
      type: "apartment",
      name: "Demo Apartment",
      price: 1500,
      city: "Mumbai",
      image: "https://via.placeholder.com/300",
      created_at: new Date().toISOString(),
    },
    {
      id: "mock-2",
      type: "hotel",
      name: "Demo Hotel",
      price: 2500,
      city: "Delhi",
      image: "https://via.placeholder.com/300",
      created_at: new Date().toISOString(),
    },
  ];

  let filtered =
    type === "all"
      ? mockData
      : mockData.filter((item) => item.type === type);

  return filtered.slice(offset, offset + limit);
}