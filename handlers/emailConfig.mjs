import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER, // EMAIL HERE
    pass: process.env.EMAIL_PASS, // PASSWORD HERE
  },
});

export default transporter;
