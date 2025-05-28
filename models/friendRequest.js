module.exports = (sequelize, DataTypes) => {
  const FriendRequest = sequelize.define("FriendRequest", {
    status: {
      type: DataTypes.ENUM("pending", "accepted", "declined"),
      defaultValue: "pending",
    },
  });

  return FriendRequest;
};