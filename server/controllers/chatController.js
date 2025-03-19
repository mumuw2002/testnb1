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
      .populate('userId', 'firstName lastName profileImage')
      .populate('readBy', 'firstName lastName')
      .sort({ createdAt: 'asc' })
      .lean();

    // ฟังก์ชันสำหรับจัดรูปแบบวันที่
    const formatDate = (date) => {
      const options = { year: 'numeric', month: 'long', day: 'numeric' };
      return date.toLocaleDateString('th-TH', options);
    };

    // ฟังก์ชันสำหรับจัดรูปแบบเวลา
    const formatTime = (date) => {
      let hours = date.getHours();
      let minutes = date.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12; // ชั่วโมง 0 จะเป็น 12 AM
      minutes = minutes < 10 ? '0' + minutes : minutes;
      return `${hours}:${minutes} ${ampm}`;
    };

    // ฟังก์ชันสำหรับตรวจสอบการเปลี่ยนวัน
    const isNewDay = (date1, date2) => {
      return (
        date1.getFullYear() !== date2.getFullYear() ||
        date1.getMonth() !== date2.getMonth() ||
        date1.getDate() !== date2.getDate()
      );
    };

    res.render('task/task-chat', {
      spaces: space,
      messages,
      user: req.user,
      layout: '../views/layouts/task',
      currentPage: 'task_chat',
      formatDate,
      formatTime,
      isNewDay, // ส่งฟังก์ชัน isNewDay ไปยัง EJS
    });
  } catch (error) {
    console.log(error);
    res.status(500).send("Internal Server Error");
  }
};

// ส่งข้อความ
exports.postMessage = async (req, res) => {
  try {
    const spaceId = req.params.id;
    const message = req.body.message;
    const mentionedUserIds = req.body.mentionedUsers || []; // รายชื่อ userid ที่ถูก mention
    const userId = req.user.id;

    if (!message || !userId || !spaceId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    const space = await Spaces.findById(spaceId);
    if (!space) {
      return res.status(404).json({ success: false, error: "Space not found" });
    }

    const usersInChat = req.app.get('usersInChat');
    const usersInSpaceChat = usersInChat.get(spaceId) || new Set();

    // ตรวจสอบว่าไม่เพิ่มผู้ส่งข้อความลงใน readBy
    const readBy = Array.from(usersInSpaceChat).filter(id => id.toString() !== userId.toString());

    const newMessage = new Chat({
      spaceId,
      userId,
      message,
      readBy: readBy,
      mentionedUsers: mentionedUserIds // บันทึก userid ที่ถูก mention
    });

    await newMessage.save();

    const populatedMessage = await Chat.findById(newMessage._id)
      .populate('userId', 'firstName lastName profileImage')
      .populate('readBy', 'firstName lastName')
      .populate('mentionedUsers', 'firstName lastName profileImage') // ดึงข้อมูลผู้ใช้ที่ถูก mention
      .lean();

    const io = req.app.get('io');
    io.emit('chat message', populatedMessage);

    // แจ้งเตือนผู้ใช้ที่ถูก mention
    if (populatedMessage.mentionedUsers.length > 0) {
      populatedMessage.mentionedUsers.forEach(user => {
        io.to(user._id).emit('new mention', {
          spaceId,
          projectName: space.projectName,
          message: populatedMessage.message,
          mentionedBy: req.user.firstName + ' ' + req.user.lastName,
          link: `/space/item/${spaceId}/chat`
        });
      });
    }

    res.status(200).json({ success: true, message: populatedMessage });
  } catch (error) {
    console.log("Error posting message:", error);
    res.status(500).json({ success: false, error: "Internal Server Error" });
  }
};

// อัปเดตสถานะการอ่านข้อความ
exports.markAsRead = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;
  const spaceId = req.params.spaceId;

  try {
    const chat = await Chat.findById(messageId);
    if (!chat) {
      return res.status(404).json({ success: false, error: "Message not found" });
    }

    // ตรวจสอบว่าผู้ใช้ไม่ใช่ผู้ส่งข้อความ
    if (chat.userId.toString() !== userId.toString() && !chat.readBy.includes(userId)) {
      chat.readBy.push(userId);
      await chat.save();

      // แจ้ง client ว่าข้อความถูกอ่าน
      req.app.get('io').emit('message read update', {
        messageId: chat._id.toString(),
        readByCount: chat.readBy.length,
      });
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

exports.getUnreadMentionsCount = async (req, res) => {
  try {
      const userId = req.user.id;

      // ดึงข้อมูลการแจ้งเตือนที่ยังไม่ได้อ่าน
      const unreadMentions = await Chat.find({
          mentionedUsers: userId,
          readBy: { $ne: userId },
      })
      .populate('userId', 'firstName lastName') // ดึงข้อมูลผู้ส่งข้อความ
      .lean();

      console.log('Unread Mentions:', unreadMentions); // Log ข้อมูล

      // ส่งข้อมูลกลับไปยัง Frontend
      return res.status(200).json({ 
          success: true, 
          unreadMentions: unreadMentions.map(mention => ({
              mentionedBy: `${mention.userId.firstName} ${mention.userId.lastName}`,
              projectName: 'Project Name', // ควรดึงข้อมูลจากฐานข้อมูล
              message: mention.message,
              link: `/space/item/${mention.spaceId}/chat`
          }))
      });
  } catch (error) {
      console.error("เกิดข้อผิดพลาดในการดึงข้อมูลการแจ้งเตือนที่ยังไม่ได้อ่าน:", error);
      return res.status(500).json({ success: false, error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
  }
};

exports.getUnreadMessageCount = async (req, res) => {
  try {
    const userId = req.user._id;
    const spaces = await Spaces.find({ 'collaborators.user': userId }).lean();

    const unreadCounts = await Promise.all(spaces.map(async (space) => {
      const unreadMessages = await Chat.countDocuments({
        spaceId: space._id,
        readBy: { $nin: [userId] }, // นับเฉพาะข้อความที่ผู้ใช้ยังไม่ได้อ่าน
        userId: { $ne: userId } // ไม่นับข้อความที่ผู้ใช้ส่งเอง
      });
      return {
        spaceId: space._id,
        projectName: space.projectName,
        unreadCount: unreadMessages
      };
    }));

    res.status(200).json({ success: true, unreadCounts });
  } catch (error) {
    console.error('Error fetching unread message counts:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};

// อัปเดตสถานะการอ่านข้อความ
exports.markAsRead = async (req, res) => {
  const { messageId } = req.params;
  const userId = req.user._id;
  const spaceId = req.params.spaceId;

  try {
    const chat = await Chat.findById(messageId);
    if (!chat) {
      return res.status(404).json({ success: false, error: "Message not found" });
    }

    // ตรวจสอบว่าผู้ใช้ยังอยู่ในหน้าแชทนี้หรือไม่
    const usersInSpaceChat = req.app.get('usersInChat').get(spaceId) || new Set();

    if (usersInSpaceChat.has(userId)) {
      // ตรวจสอบว่าผู้ใช้ไม่ใช่ผู้ส่งข้อความ
      if (chat.userId.toString() !== userId.toString() && !chat.readBy.includes(userId)) {
        chat.readBy.push(userId);
        await chat.save();

        // แจ้ง client ว่าข้อความถูกอ่าน
        req.app.get('io').emit('message read update', {
          messageId: chat._id.toString(),
          readByCount: chat.readBy.length,
        });
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// ค้นหาผู้ใช้ตามชื่อ
exports.searchUsers = async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { query } = req.query;

    // ค้นหา space และ populate collaborators.user
    const space = await Spaces.findById(spaceId).populate('collaborators.user', 'firstName lastName profileImage');
    if (!space) {
      return res.status(404).json({ success: false, error: "Space not found" });
    }

    // ดึงข้อมูลผู้ใช้จาก collaborators และกรอง user ที่ไม่ใช่ null และไม่ใช่ตัวเอง
    let users = space.collaborators
      .map(collab => collab.user)
      .filter(user => user !== null && user._id.toString() !== req.user._id.toString()); // ตรวจสอบว่า user ไม่ใช่ null และไม่ใช่ตัวเอง

    // ถ้ามี query ให้กรองผู้ใช้ตาม query
    if (query) {
      users = users.filter(user => 
        user.firstName.toLowerCase().includes(query.toLowerCase()) ||
        user.lastName.toLowerCase().includes(query.toLowerCase())
      );
    }

    res.json({ success: true, users });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

// ใน chatController.js
exports.markAllAsRead = async (req, res) => {
  const { spaceId } = req.params;
  const { userId } = req.body;

  try {
    // อัปเดตข้อความทั้งหมดใน Space ที่ยังไม่ได้อ่าน
    await Chat.updateMany(
      { spaceId, readBy: { $ne: userId } }, // ค้นหาข้อความที่ผู้ใช้ยังไม่ได้อ่าน
      { $push: { readBy: userId } } // เพิ่ม userId เข้าไปใน readBy
    );

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
};