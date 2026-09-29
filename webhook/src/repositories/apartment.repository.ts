import { hasuraRequest } from '../services/hasura'

export interface ApartmentWithWallet {
  id: string
  name?: string | null
  owner_id?: string | null
  ownerWallet: string | null
}

export async function getApartmentWithOwnerWallet(
  apartmentId: string
): Promise<ApartmentWithWallet | null> {
  const query = `
    query GetApartmentWithOwnerWallet($apartmentId: uuid!) {
      apartments_by_pk(id: $apartmentId) {
        id
        name
        owner_id
        owner_wallet
      }
    }
  `

  const data = await hasuraRequest<{
    apartments_by_pk?: {
      id: string
      name?: string | null
      owner_id?: string | null
      owner_wallet?: string | null
    } | null
  }>(query, { apartmentId })

  const apartment = data?.apartments_by_pk
  if (!apartment) {
    return null
  }

  return {
    id: apartment.id,
    name: apartment.name,
    owner_id: apartment.owner_id,
    ownerWallet: apartment.owner_wallet ?? null,
  }
}
