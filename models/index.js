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

// Load models
db.Role = require("./role")(sequelize, DataTypes);
db.User = require("./user")(sequelize, DataTypes);
db.Profile = require("./profile")(sequelize, DataTypes);
db.Category = require("./category")(sequelize, DataTypes);
db.Post = require("./post")(sequelize, DataTypes);
db.Comment = require("./comment")(sequelize, DataTypes);
db.FriendRequest = require("./friendRequest")(sequelize, DataTypes);

// --- Define Associations ---

// Role <-> User
db.Role.hasMany(db.User, { foreignKey: "roleId", as: "users" });
db.User.belongsTo(db.Role, { foreignKey: "roleId", as: "role" });

// User <-> Profile
db.User.hasOne(db.Profile, { foreignKey: "userId", as: "profile" });
db.Profile.belongsTo(db.User, { foreignKey: "userId", as: "user" });

// User <-> Post
db.User.hasMany(db.Post, { foreignKey: "userId", as: "posts" });
db.Post.belongsTo(db.User, { foreignKey: "userId", as: "user" });

// Category <-> Post
db.Category.hasMany(db.Post, { foreignKey: "categoryId", as: "posts" });
db.Post.belongsTo(db.Category, { foreignKey: "categoryId", as: "category" });

// Post <-> Comment
db.Post.hasMany(db.Comment, {
  foreignKey: "postId",
  as: "comments",
  onDelete: "CASCADE",
  hooks: true,
});
db.Comment.belongsTo(db.Post, { foreignKey: "postId", as: "post" });

// User <-> Comment
db.User.hasMany(db.Comment, { foreignKey: "userId", as: "comments" });
db.Comment.belongsTo(db.User, { foreignKey: "userId", as: "user" });

// Nested Comments (Replies)
db.Comment.belongsTo(db.Comment, {
  as: "parent",
  foreignKey: "parentId",
});
db.Comment.hasMany(db.Comment, {
  as: "replies",
  foreignKey: "parentId",
  onDelete: "CASCADE",
  hooks: true,
});

// FriendRequest <-> User
db.FriendRequest.belongsTo(db.User, {
  as: "sender",
  foreignKey: "senderId",
});
db.FriendRequest.belongsTo(db.User, {
  as: "receiver",
  foreignKey: "receiverId",
});
db.User.hasMany(db.FriendRequest, {
  as: "sentRequests",
  foreignKey: "senderId",
});
db.User.hasMany(db.FriendRequest, {
  as: "receivedRequests",
  foreignKey: "receiverId",
});

module.exports = db;