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
const schedule = require('node-schedule'); 
const SystemAnnouncement = require('./server/models/SystemAnnouncements');
const bcrypt = require("bcrypt");

const app = express();
const port = process.env.PORT || 5001;

// เชื่อมต่อฐานข้อมูล
connectDB()
  .then(() => {
    console.log('Connected to database');
    createAdminUser(); // สร้าง Admin เมื่อเชื่อมต่อฐานข้อมูลสำเร็จ
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
app.use('/', require('./server/routes/adminRoutes'));
app.use('/', require('./server/routes/collabRoutes'));

// Handle 404
app.get('*', (req, res) => {
  res.status(404).render('404');
});

// Start server
app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});

// ✅ สร้าง Admin User
async function createAdminUser() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;
    const existingAdmin = await User.findOne({ googleEmail: adminEmail });

    if (!existingAdmin) {
      const newAdmin = new User({
        googleEmail: adminEmail,
        username: 'Administrator',
        role: 'admin',
      });

      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await User.register(newAdmin, hashedPassword);
      console.log('Admin user created successfully.');
    }
  } catch (err) {
    console.error('Failed to create admin user:', err);
  }
}

// ✅ ลบประกาศที่หมดอายุ
schedule.scheduleJob('0 0 * * *', async () => {
  try {
    const now = new Date();
    const result = await SystemAnnouncement.updateMany(
      { expirationDate: { $lt: now }, isDeleted: { $ne: true } },
      { isDeleted: true, updatedAt: now }
    );
    console.log(`${result.modifiedCount} expired announcements moved to history.`);
  } catch (error) {
    console.error('Error moving expired announcements to history:', error);
  }
});