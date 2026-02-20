import request from "supertest";
import app from "../bin/server.mjs";

describe("GET /api/properties", () => {
  it("should return properties", async () => {
    const res = await request(app).get("/api/properties");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
