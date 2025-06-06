module.exports = (sequelize, DataTypes) => {
  const Post = sequelize.define("Post", {
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    // Media fields
    photoUrl: {
      type: DataTypes.STRING,
      allowNull: true,  // optional
    },
    gifUrl: {  // New field for storing GIF URLs
      type: DataTypes.STRING,
      allowNull: true,  // optional
    },
    youtubeUrl: {  // New field for storing YouTube URLs
      type: DataTypes.STRING,
      allowNull: true,  // optional
    },
  });

  Post.associate = (models) => {
    Post.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    Post.belongsTo(models.Category, { foreignKey: "categoryId", as: "category" });
  };

  return Post;
};