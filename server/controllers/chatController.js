const Chat = require('../models/Chat');
const Spaces = require('../models/Space');
const User = require('../models/User');
const mongoose = require('mongoose');

// เรนเดอร์หน้าแชท
exports.renderChatPage = async (req, res) => {
  try {
      const spaceId = req.params.id;
      const space = await Spaces.findById(spaceId).populate('collaborators.user', 'username profileImage').lean();

      if (!space) {
          return res.status(404).send("Space not found");
      }

      const messages = await Chat.find({ spaceId })
          .populate('userId', 'firstName lastName profileImage') // ปรับปรุงการ populate
          .sort({ createdAt: 'asc' })
          .lean();

      res.render('task/task-chat', {
          spaces: space,
          messages,
          user: req.user,
          layout: '../views/layouts/task',
          currentPage: 'task_chat'
      });
  } catch (error) {
      console.log(error);
      res.status(500).send("Internal Server Error");
  }
};

exports.postMessage = async (req, res) => {
  try {
    const spaceId = req.params.id;
    const message = req.body.message;
    const userId = req.user.id;

    const newMessage = new Chat({
      spaceId,
      userId,
      message
    });

    await newMessage.save();

    // ส่งข้อความผ่าน Socket.IO
    const populatedMessage = await Chat.findById(newMessage._id).populate('userId', 'firstName lastName profileImage').lean();
    const io = req.app.get('io'); // ใช้ req.app.get('io') เพื่อเข้าถึง Socket.IO instance
    io.emit('chat message', populatedMessage);

    res.status(200).json({ success: true, message: populatedMessage });
  } catch (error) {
    console.log("Error posting message:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

