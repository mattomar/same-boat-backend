module.exports = (db, sequelize, DataTypes) => {
  // One row per pair of users. user1Id is always the smaller ID.
  const Conversation = sequelize.define(
    "Conversation",
    {
      user1Id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      user2Id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      lastMessageAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      deletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["user1Id", "user2Id"],
        },
      ],
      validate: {
        orderedPair() {
          if (this.user1Id >= this.user2Id) {
            throw new Error("user1Id must be smaller than user2Id");
          }
        },
      },
    },
  );

  const Message = sequelize.define(
    "Message",
    {
      conversationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      senderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      text: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      readAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      deletedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      indexes: [
        {
          fields: ["conversationId", "id"],
        },
        {
          fields: ["conversationId", "readAt"],
        },
      ],
    },
  );

  // Separate from FriendRequest. The first message is stored here
  // until the receiver accepts the request.
  const MessageRequest = sequelize.define(
    "MessageRequest",
    {
      senderId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      receiverId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM("pending", "accepted", "declined"),
        allowNull: false,
        defaultValue: "pending",
      },
      initialMessage: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      // "smallerId:largerId" prevents duplicate pending requests.
      pairKey: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      conversationId: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      respondedAt: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["pairKey"],
          where: { status: "pending" },
        },
        {
          fields: ["receiverId", "status"],
        },
        {
          fields: ["senderId"],
        },
      ],
    },
  );

  Conversation.belongsTo(db.User, {
    as: "user1",
    foreignKey: "user1Id",
    onDelete: "CASCADE",
  });

  Conversation.belongsTo(db.User, {
    as: "user2",
    foreignKey: "user2Id",
    onDelete: "CASCADE",
  });

  Conversation.hasMany(Message, {
    as: "messages",
    foreignKey: "conversationId",
    onDelete: "CASCADE",
  });

  Message.belongsTo(Conversation, {
    as: "conversation",
    foreignKey: "conversationId",
  });

  Message.belongsTo(db.User, {
    as: "sender",
    foreignKey: "senderId",
    onDelete: "CASCADE",
  });

  MessageRequest.belongsTo(db.User, {
    as: "sender",
    foreignKey: "senderId",
    onDelete: "CASCADE",
  });

  MessageRequest.belongsTo(db.User, {
    as: "receiver",
    foreignKey: "receiverId",
    onDelete: "CASCADE",
  });

  MessageRequest.belongsTo(Conversation, {
    as: "conversation",
    foreignKey: "conversationId",
    onDelete: "SET NULL",
  });

  db.Conversation = Conversation;
  db.Message = Message;
  db.MessageRequest = MessageRequest;
};
