import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "blackride1988@gmail.com",
    pass: "tkar cvom idqm lqqt", // Sustituir con la contraseña generada
  },
});

export default transporter;

