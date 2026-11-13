module.exports = (sequelize, DataTypes) => {
  const Block = sequelize.define(
    "Block",
    {
      blockerId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      blockedUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["blockerId", "blockedUserId"],
        },
      ],
    },
  );

  return Block;
};
