module.exports = (sequelize, DataTypes) => {
  const Post = sequelize.define("Post", {
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // Optional media fields:
    photoUrl: {
      type: DataTypes.STRING,
      allowNull: true,  // optional
    },
    videoUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    audioUrl: {
      type: DataTypes.STRING,
      allowNull: true,
    },
  });

  Post.associate = (models) => {
    Post.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    Post.belongsTo(models.Category, { foreignKey: "categoryId", as: "category" });
  };

  return Post;
};