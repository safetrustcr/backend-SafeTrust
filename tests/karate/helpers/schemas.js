function fn() {
  const schemas = {
    user: {
      id: "#string",
      email: "#string",
      first_name: "##string",
      last_name: "##string",
      country_code: "##string",
      phone_number: "##string",
      last_seen: "#string",
    },
    wallet: {
      id: "#string",
      wallet_address: "#string",
      chain_type: "#string",
      is_primary: "#boolean",
      created_at: "#string",
    },
    error: {
      message: "#string",
      extensions: {
        code: "#string",
        path: "#array",
      },
    },
  };

  return schemas;
}
