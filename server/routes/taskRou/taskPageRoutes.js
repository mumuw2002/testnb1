const express = require('express');
const router = express.Router();
const taskPageController = require('../../controllers/taskCon/taskPageController');
const { isLoggedIn } = require('../../middleware/checkAuth');
const spaceController = require('../../controllers/spaceController');
const { uploadCovers } = require('../../middleware/upload');
const chatController = require('../../controllers/chatController');

router.get('/space/item/:id/dashboard', isLoggedIn, taskPageController.task_dashboard);
router.get('/space/item/:id/task_list', isLoggedIn, taskPageController.task_list);
router.get('/space/item/:id/task_board', isLoggedIn, taskPageController.task_board);
router.get('/space/item/:id/granttChart', isLoggedIn, taskPageController.granttChart); 

router.get('/space/item/:id/chat', isLoggedIn, chatController.renderChatPage);
router.post('/space/item/:id/chat', isLoggedIn, chatController.postMessage);

module.exports = router;