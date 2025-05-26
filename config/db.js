require("dotenv").config();

const { Sequelize } = require("sequelize");



const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,  // make sure your .env uses DB_PASSWORD (not DB_PASS)
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    logging: false,
    dialectOptions: {
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    },
  }
);

module.exports = { sequelize };