module.exports = (sequelize, DataTypes) => {
  const Report = sequelize.define(
    "Report",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      reporterId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      reportedUserId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      targetType: {
        type: DataTypes.ENUM("user", "post", "comment"),
        allowNull: false,
      },

      targetId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      reason: {
        type: DataTypes.STRING,
        allowNull: false,
      },

      details: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      // Snapshot of the reported content at submission time.
      // Preserves evidence even if the original content is deleted.
      targetSnapshot: {
        type: DataTypes.JSONB,
        allowNull: true,
      },

      status: {
        type: DataTypes.ENUM("pending", "reviewed", "actioned", "dismissed"),
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

      resolutionNote: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      indexes: [
        { fields: ["reporterId"] },
        { fields: ["reportedUserId"] },
        { fields: ["targetType", "targetId"] },
        { fields: ["status"] },
      ],
    },
  );

  return Report;
};
