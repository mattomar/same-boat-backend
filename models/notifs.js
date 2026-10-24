module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define("Notification", {
    type: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    message: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    isRead: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    senderId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },

    postId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    friendRequestId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    handled: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  });

  return Notification;
};
