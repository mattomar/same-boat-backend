module.exports = (sequelize, DataTypes) => {
  const ModerationAppeal = sequelize.define(
    "ModerationAppeal",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      userId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      moderationLogId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },

      explanation: {
        type: DataTypes.TEXT,
        allowNull: false,
      },

      status: {
        type: DataTypes.ENUM("pending", "accepted", "rejected"),
        allowNull: false,
        defaultValue: "pending",
      },

      reviewedBy: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      reviewedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },

      adminResponse: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      indexes: [
        { fields: ["userId"] },
        { fields: ["status"] },
        { fields: ["reviewedBy"] },
        { fields: ["createdAt"] },
      ],
    },
  );

  return ModerationAppeal;
};
