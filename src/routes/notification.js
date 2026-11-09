import { Router } from "express";
import mongoose from "mongoose";

import Notification from "../models/Notification.js";

const router = Router();

// GET /notifications
// Returns the latest 30 notifications for the logged-in user.
router.get("/", async (req, res, next) => {
  try {
    const recipientId = req.user.id;

    const [notifications, unreadCount] = await Promise.all([
      Notification.find({ recipientId })
        .populate("ticketId", "subject status")
        .sort({ createdAt: -1 })
        .limit(30)
        .lean(),

      Notification.countDocuments({
        recipientId,
        isRead: false,
      }),
    ]);

    return res.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/unread-count", async (req, res, next) => {
  try {
    const unreadCount = await Notification.countDocuments({
      recipientId: req.user.id,
      isRead: false,
    });

    return res.json({ unreadCount });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id/read", async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({
        message: "Invalid notification ID.",
      });
    }

    const notification = await Notification.findOneAndUpdate(
      {
        _id: id,
        recipientId: req.user.id,
      },
      { $set: { isRead: true } },
      { new: true },
    ).lean();

    if (!notification) {
      return res.status(404).json({
        message: "Notification not found.",
      });
    }

    return res.json({ notification });
  } catch (error) {
    next(error);
  }
});

router.patch("/read-all", async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      {
        recipientId: req.user.id,
        isRead: false,
      },
      { $set: { isRead: true } },
    );

    return res.json({
      message: "All notifications marked as read.",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
