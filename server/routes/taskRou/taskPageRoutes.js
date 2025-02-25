const express = require('express');
const router = express.Router();
const taskPageController = require('../../controllers/taskCon/taskPageController');
const { isLoggedIn } = require('../../middleware/checkAuth');

router.get('/space/item/:id/dashboard', isLoggedIn, taskPageController.task_dashboard);
router.get('/space/item/:id/task_list', isLoggedIn, taskPageController.task_list);
router.get('/space/item/:id/task_board', isLoggedIn, taskPageController.task_board);
router.get('/space/item/:id/granttChart', isLoggedIn, taskPageController.granttChart); 

module.exports = router;