const { GraphQLClient, gql } = require('graphql-request');
const { logger } = require('../utils/logger');

const GET_APARTMENT_BY_ID = gql`
  query GetApartmentById($id: uuid!) {
    apartments_by_pk(id: $id) {
      id
      name
      description
      price
      warranty_deposit
      address
      location_area
      is_available
      available_from
      available_until
      created_at
      updated_at
      apartment_images {
        id
        image_url
        image_key
        created_at
      }
    }
  }
`;

const GET_HOTEL_BY_ID = gql`
  query GetHotelById($id: uuid!) {
    hotels_by_pk(id: $id) {
      id
      name
      description
      address
      location_area
      created_at
      updated_at
    }
  }
`;

function getHasuraClient() {
  const endpoint = process.env.HASURA_GRAPHQL_ENDPOINT;
  const adminSecret = process.env.HASURA_GRAPHQL_ADMIN_SECRET;

  if (!endpoint || !adminSecret) {
    throw new Error('HASURA_GRAPHQL_ENDPOINT and HASURA_GRAPHQL_ADMIN_SECRET must be set');
  }

  return new GraphQLClient(endpoint, {
    headers: {
      'x-hasura-admin-secret': adminSecret,
    },
  });
}

function normalizeApartment(apartment) {
  return {
    id: apartment.id,
    type: 'apartment',
    name: apartment.name,
    description: apartment.description || null,
    price: apartment.price,
    warranty_deposit: apartment.warranty_deposit,
    address: apartment.address,
    location_area: apartment.location_area || null,
    is_available: apartment.is_available,
    available_from: apartment.available_from,
    available_until: apartment.available_until || null,
    images: (apartment.apartment_images || []).map((img) => ({
      id: img.id,
      url: img.image_url,
      image_key: img.image_key,
      created_at: img.created_at,
    })),
    created_at: apartment.created_at,
    updated_at: apartment.updated_at,
  };
}

function normalizeHotel(hotel) {
  return {
    id: hotel.id,
    type: 'hotel',
    name: hotel.name,
    description: hotel.description || null,
    address: hotel.address,
    location_area: hotel.location_area || null,
    images: [],
    created_at: hotel.created_at,
    updated_at: hotel.updated_at,
  };
}

async function getPropertyById(id) {
  const client = getHasuraClient();

  // Try apartment first
  try {
    const apartmentData = await client.request(GET_APARTMENT_BY_ID, { id });
    if (apartmentData.apartments_by_pk) {
      return normalizeApartment(apartmentData.apartments_by_pk);
    }
  } catch (error) {
    logger.warn('Error querying apartment', { id, error: error.message });
  }

  // Fall back to hotel
  try {
    const hotelData = await client.request(GET_HOTEL_BY_ID, { id });
    if (hotelData.hotels_by_pk) {
      return normalizeHotel(hotelData.hotels_by_pk);
    }
  } catch (error) {
    logger.warn('Error querying hotel', { id, error: error.message });
  }

  return null;
}

module.exports = { getPropertyById };
