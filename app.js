require('dotenv').config();
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const methodOverride = require('method-override');
const connectDB = require('./server/config/db');
const session = require('express-session');
const passport = require('passport');
const MongoStore = require('connect-mongo');
const path = require('path');
const cookieParser = require('cookie-parser');
const flash = require('connect-flash');
const LocalStrategy = require('passport-local').Strategy;
const User = require('./server/models/User');
const moment = require('moment');
const bodyParser = require('body-parser');
const lineWebhook = require('./server/routes/lineWebhook');
const http = require('http');
const socketIo = require('socket.io');
const Chat = require('./server/models/Chat');

const app = express();
const port = process.env.PORT || 5001;
const server = http.createServer(app);
const io = socketIo(server);

app.set('io', io);

// เชื่อมต่อฐานข้อมูล
connectDB()
  .then(() => {
    console.log('Connected to database');
  })
  .catch(err => {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  });

// Middleware สำหรับ parse body
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Session Middleware ✅ ต้องมาก่อน passport
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'keyboard cat',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
      mongoUrl: process.env.MONGODB_URI,
      collectionName: 'sessions',
    }),
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'Lax',
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

// Passport Local Strategy
passport.use(
  new LocalStrategy(
    { usernameField: 'googleEmail', passwordField: 'password' },
    User.authenticate()
  )
);

passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/img', express.static(path.join(__dirname, 'public/img')));
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/docUploads', express.static(path.join(__dirname, 'docUploads')));
app.use(methodOverride('_method'));
app.use('/webhook', lineWebhook);

// Flash messages
app.use(flash());

app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// Middleware to handle due date validation
app.use((req, res, next) => {
  if (req.body.dueDate) {
    const dueDate = moment(req.body.dueDate, moment.ISO_8601, true);
    if (!dueDate.isValid()) {
      req.flash('error', 'Invalid date format');
      return res.redirect('back');
    }
    req.body.dueDate = dueDate.toISOString();
  }
  next();
});

// Update lastActive
app.use(async (req, res, next) => {
  if (req.isAuthenticated()) {
    try {
      req.user.lastActive = Date.now();
      await req.user.save();
    } catch (error) {
      console.error('Error updating lastActive:', error);
    }
  }
  next();
});

// Templating Engine
app.use(expressLayouts);
app.set('layout', './layouts/main');
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(require('express-ejs-layouts'));

// Routes
app.use('/', require('./server/routes/auth'));
app.use('/', require('./server/routes/index'));
app.use('/', require('./server/routes/spaceRoutes'));
app.use('/', require('./server/routes/taskRou/taskRoutes'));
app.use('/', require('./server/routes/taskRou/taskPageRoutes'));
app.use('/', require('./server/routes/taskRou/taskDetailRoutes'));
app.use('/', require('./server/routes/taskRou/taskComplaintRouter'));
app.use('/', require('./server/routes/notiRoutes'));
app.use('/', require('./server/routes/subtaskRoutes'));
app.use('/', require('./server/routes/settingRoutes'));
app.use('/', require('./server/routes/userRoutes'));
app.use('/', require('./server/routes/collabRoutes'));

// Handle 404
app.get('*', (req, res) => {
  res.status(404).render('404');
});

// WebSocket Setup
// ตั้งค่า usersInChat ใน app
const usersInChat = new Map(); // เก็บข้อมูลผู้ใช้ที่อยู่ในหน้าแชท
app.set('usersInChat', usersInChat);

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('🔌 User disconnected:', socket.id);
  });

  // เมื่อผู้ใช้อยู่ในหน้าแชท
  socket.on('user in chat', async ({ userId, spaceId }) => {
    if (!usersInChat.has(spaceId)) {
      usersInChat.set(spaceId, new Set());
    }
    usersInChat.get(spaceId).add(userId);

    console.log(`User ${userId} is in chat for space ${spaceId}`);

    // อัปเดตสถานะ readBy สำหรับข้อความที่ยังไม่ได้อ่าน
    const unreadMessages = await Chat.find({
      spaceId,
      readBy: { $ne: userId }
    });

    unreadMessages.forEach(async (msg) => {
      // ตรวจสอบว่า userId ไม่ใช่ผู้ส่งข้อความ
      if (msg.userId.toString() !== userId.toString()) {
        msg.readBy.push(userId);
        await msg.save();

        // แจ้ง client ว่าข้อความถูกอ่าน
        io.emit('message read update', {
          messageId: msg._id.toString(),
          readByCount: msg.readBy.length,
        });
      }
    });
  });

  // เมื่อผู้ใช้ออกจากหน้าแชท
  socket.on('user left chat', ({ userId, spaceId }) => {
    if (usersInChat.has(spaceId)) {
      usersInChat.get(spaceId).delete(userId);
      console.log(`User ${userId} left chat for space ${spaceId}`);
    }
  });

  // เมื่อผู้ใช้กลับเข้ามาในหน้าแชท
  socket.on('user returned to chat', ({ userId, spaceId }) => {
    if (!usersInChat.has(spaceId)) {
      usersInChat.set(spaceId, new Set());
    }
    usersInChat.get(spaceId).add(userId);

    console.log(`User ${userId} returned to chat for space ${spaceId}`);

    // อัปเดตสถานะ readBy สำหรับข้อความที่ยังไม่ได้อ่าน
    Chat.find({
      spaceId,
      readBy: { $ne: userId }
    }).then((unreadMessages) => {
      unreadMessages.forEach((msg) => {
        // ตรวจสอบว่า userId ไม่ใช่ผู้ส่งข้อความ
        if (msg.userId.toString() !== userId.toString()) {
          msg.readBy.push(userId);
          msg.save();

          // แจ้ง client ว่าข้อความถูกอ่าน
          io.emit('message read update', {
            messageId: msg._id.toString(),
            readByCount: msg.readBy.length,
          });
        }
      });
    });
  });

  // เมื่อมีข้อความใหม่
  socket.on('send message', async ({ spaceId, message, userId, mentionedUsers }) => {
    const newMessage = new Chat({
      spaceId,
      userId,
      message,
      readBy: [],
      mentionedUsers: mentionedUsers || []
    });

    await newMessage.save();
    const populatedMessage = await Chat.findById(newMessage._id)
      .populate('userId', 'firstName lastName profileImage')
      .populate('mentionedUsers', 'firstName lastName')
      .lean();

    io.emit('chat message', populatedMessage);

    // แจ้งเตือนผู้ใช้ที่ถูก mention
    if (mentionedUsers && mentionedUsers.length > 0) {
      mentionedUsers.forEach(userId => {
        io.to(userId).emit('new mention', {
          spaceId,
          projectName: 'Project Name', // ควรดึงข้อมูลจากฐานข้อมูล
          message: populatedMessage.message,
          mentionedBy: populatedMessage.userId.firstName + ' ' + populatedMessage.userId.lastName,
          link: `/space/item/${spaceId}/chat`
        });
      });
    }

    // แจ้งเตือนผู้ใช้ที่ไม่ได้อยู่ในหน้าแชท
    const usersToNotify = usersInChat.get(spaceId) || new Set();
    usersToNotify.forEach(id => {
      if (id !== userId && !mentionedUsers.includes(id)) {
        io.to(id).emit('new unread message', {
          spaceId,
          projectName: 'Project Name', // ควรดึงข้อมูลจากฐานข้อมูล
          unreadCount: 1,
          lastMessage: message,
          link: `/space/item/${spaceId}/chat`
        });
      }
    });
  });
});

server.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});