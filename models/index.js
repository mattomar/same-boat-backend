const { Sequelize, DataTypes } = require("sequelize");
require("dotenv").config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: "postgres",
    dialectOptions: {
      ssl: process.env.DB_SSL === "true"
        ? { require: true, rejectUnauthorized: false }
        : false,
    },
    logging: false,
  }
);

const db = {};
db.sequelize = sequelize;
db.Sequelize = Sequelize;

// Import Models
db.Role = require("./role")(sequelize, DataTypes);
db.User = require("./user")(sequelize, DataTypes);
db.Profile = require("./profile")(sequelize, DataTypes);
db.Category = require("./category")(sequelize, DataTypes);
db.Post = require("./post")(sequelize, DataTypes);
db.Comment = require("./comment")(sequelize, DataTypes);

// Associations
db.Role.hasMany(db.User, { foreignKey: "roleId", as: "users" });
db.User.belongsTo(db.Role, { foreignKey: "roleId", as: "role" });

db.User.hasOne(db.Profile, { foreignKey: "userId", as: "profile" });
db.Profile.belongsTo(db.User, { foreignKey: "userId", as: "user" });

db.User.hasMany(db.Post, { foreignKey: "userId", as: "posts" });
db.Post.belongsTo(db.User, { foreignKey: "userId", as: "user" });

db.Category.hasMany(db.Post, { foreignKey: "categoryId", as: "posts" });
db.Post.belongsTo(db.Category, { foreignKey: "categoryId", as: "category" });

// Comments
db.User.hasMany(db.Comment, { foreignKey: "userId", as: "comments" });
db.Comment.belongsTo(db.User, { foreignKey: "userId", as: "user" });

db.Post.hasMany(db.Comment, { foreignKey: "postId", as: "comments", onDelete: "CASCADE" });
db.Comment.belongsTo(db.Post, { foreignKey: "postId", as: "post" });

db.Comment.belongsTo(db.Comment, { as: "parent", foreignKey: "parentId" });
db.Comment.hasMany(db.Comment, { as: "replies", foreignKey: "parentId", onDelete: "CASCADE" });

module.exports = db;