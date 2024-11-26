import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "safetrust.email",  // EMAIL HERE
    pass: "safetust.password", // PASSWORD HERE
  },
});

export default transporter;

