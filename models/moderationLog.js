module.exports = (sequelize, DataTypes) => {
  const ModerationLog = sequelize.define(
    "ModerationLog",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },

      adminId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      reportId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      targetUserId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      targetType: {
        type: DataTypes.ENUM("user", "post", "comment"),
        allowNull: true,
      },

      targetId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },

      action: {
        type: DataTypes.ENUM(
          "ban_user",
          "unban_user",
          "remove_content",
          "dismiss_report",
          "review_report",
          "review_appeal",
        ),
        allowNull: false,
      },

      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      indexes: [
        { fields: ["adminId"] },
        { fields: ["targetUserId"] },
        { fields: ["reportId"] },
        { fields: ["createdAt"] },
      ],
    },
  );

  return ModerationLog;
};
