import { runHasuraQuery } from "../config/hasuraClient.mjs";

export async function getProperties({
  type = "all",
  limit = 10,
  offset = 0,
}) {
  const queries = [];

  if (type === "all" || type === "apartment") {
    queries.push(`
      apartments: apartments(
        where: { is_available: { _eq: true } }
        limit: ${limit}
        offset: ${offset}
      ) {
        id
        name
        city
        price
        images(limit:1) { url }
        type: "apartment"
      }
    `);
  }

  if (type === "all" || type === "hotel") {
    queries.push(`
      hotels: hotels(
        where: { is_available: { _eq: true } }
        limit: ${limit}
        offset: ${offset}
      ) {
        id
        name
        city
        price_per_night
        images(limit:1) { url }
        type: "hotel"
      }
    `);
  }

  const query = `
    query GetProperties {
      ${queries.join("\n")}
    }
  `;

  const data = await runHasuraQuery(query);

  let properties = [];

  if (data.apartments) {
    properties.push(
      ...data.apartments.map(a => ({
        id: a.id,
        name: a.name,
        city: a.city,
        price: a.price,
        type: "apartment",
        image: a.images?.[0]?.url || null,
      }))
    );
  }

  if (data.hotels) {
    properties.push(
      ...data.hotels.map(h => ({
        id: h.id,
        name: h.name,
        city: h.city,
        price: h.price_per_night,
        type: "hotel",
        image: h.images?.[0]?.url || null,
      }))
    );
  }

  return properties;
}
