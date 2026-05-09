module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define("User", {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    firstName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    lastName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    bio: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    avatarUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isValidUrl(value) {
          if (value && !/^https?:\/\/.+/.test(value)) {
            throw new Error("Invalid URL format");
          }
        },
      },
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        len: [3, 25],
        is: /^[a-zA-Z0-9_.-]*$/i,
      },
    },
  });

  User.associate = (models) => {
    User.hasOne(models.Profile, {
      foreignKey: "userId",
      as: "profile",
    });

    User.hasMany(models.Post, {
      foreignKey: "userId",
      as: "posts",
    });
  };

  return User;
};
