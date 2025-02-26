document.addEventListener('DOMContentLoaded', function () {
    // Handle sidebar toggle
    const body = document.querySelector("body"),
        sidebar = body.querySelector(".sidebar"),
        toggle = body.querySelector(".toggle"),
        overlay = document.getElementById('overlay'),
        toggleBtn = document.getElementById('arrow-btn'),
        searchBtn = body.querySelector(".search-box"),
        modeSwitch = body.querySelector(".toggle-switch"),
        modeText = body.querySelector(".mode-text");

    // ตรวจสอบว่า element มีอยู่ใน DOM
    if (!toggle) {
        console.error("Element with class 'toggle' not found!");
        return;
    }

    if (!sidebar) {
        console.error("Element with class 'sidebar' not found!");
        return;
    }

    if (!toggleBtn) {
        console.error("Element with id 'arrow-btn' not found!");
        return;
    }

    // Sidebar toggle button functionality
    toggle.addEventListener("click", () => {
        sidebar.classList.toggle("close");
    });

    toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('close');
        // Check if the sidebar is open or closed
        if (sidebar.classList.contains('close')) {
            overlay.classList.remove('show');
        } else {
            overlay.classList.add('show');
        }
    });

    // Hide overlay when clicked
    overlay.addEventListener('click', () => {
        sidebar.classList.add('close');
        overlay.classList.remove('show');
    });

    // Log current path for debugging
    console.log(window.location.pathname);

    // Make the active menu item based on the current path
    const currentPath = window.location.pathname;
    const menuItems = document.querySelectorAll('.nav-links');

    menuItems.forEach(item => {
        const link = item.querySelector('a');
        if (link.getAttribute('href') === currentPath) {
            item.classList.add('active');
        }
    });

    // Color the space icons with random colors
    const spaceIcons = document.querySelectorAll('#spaceicon');

    // Background and text colors
    const colors = [{
        background: '#FFE0B2',
        text: '#E65100'
    }, // Light yellow - Dark orange text
    {
        background: '#C5CAE9',
        text: '#1A237E'
    }, // Light blue - Dark blue text
    {
        background: '#B3E5FC',
        text: '#01579B'
    }, // Light blue - Dark blue text
    {
        background: '#D1C4E9',
        text: '#4A148C'
    } // Light purple - Dark purple text
    ];

    spaceIcons.forEach(spaceIcon => {
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        // Set background and text color
        spaceIcon.style.backgroundColor = randomColor.background;
        spaceIcon.style.color = randomColor.text;
    });
});