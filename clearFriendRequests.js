const { FriendRequest, Notification } = require("./models");

const clearFriendRequests = async () => {
  await FriendRequest.destroy({
    where: {},
  });

  await Notification.destroy({
    where: {
      type: "friend_request",
    },
  });

  console.log("All friend requests and friend request notifications deleted.");
};

clearFriendRequests();
