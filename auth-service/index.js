const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { request, gql } = require("graphql-request");

const app = express();
app.use(express.json());

app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const query = gql`
      query GetUser($email: String!) {
        users(where: { email: { _eq: $email } }) {
          id
          password
        }
      }
    `;

    const response = await request(
      process.env.HASURA_ENDPOINT,
      query,
      { email },
      {
        "x-hasura-admin-secret": process.env.HASURA_ADMIN_SECRET,
      }
    );

    const user = response.users[0];

    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        hasura: {
          "x-hasura-allowed-roles": ["user"],
          "x-hasura-default-role": "user",
          "x-hasura-user-id": user.id,
        },
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(3001, () => {
  console.log("Auth service running on port 3001");
});
