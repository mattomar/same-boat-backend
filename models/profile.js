module.exports = (sequelize, DataTypes) => {
    const Profile = sequelize.define("Profile", {
      bio: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      avatarUrl: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      phone: {
        type: DataTypes.STRING,
        allowNull: true,
      },
      // add more fields as needed
    });
  
    Profile.associate = (models) => {
      Profile.belongsTo(models.User, { foreignKey: "userId", as: "user" });
    };
  
    return Profile;
  };