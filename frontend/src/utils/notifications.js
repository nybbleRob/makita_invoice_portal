/**
 * Notifications Utility
 * Manages user notifications for the notification bell dropdown
 */

// Sample notifications - in production, this would come from an API
let notifications = [
  {
    id: 1,
    type: 'info',
    title: 'Welcome to eInvoice Portal',
    message: 'Your dashboard is ready to use.',
    time: '2 hours ago',
    read: false
  }
];

export const getNotifications = () => {
  return notifications.filter(n => !n.read);
};

export const getAllNotifications = () => {
  return notifications;
};

export const markAsRead = (id) => {
  const notification = notifications.find(n => n.id === id);
  if (notification) {
    notification.read = true;
  }
};

export const markAllAsRead = () => {
  notifications.forEach(n => n.read = true);
};

export const addNotification = (notification) => {
  const newNotification = {
    id: Date.now(),
    type: notification.type || 'info',
    title: notification.title || 'Notification',
    message: notification.message || '',
    time: 'Just now',
    read: false,
    ...notification
  };
  notifications.unshift(newNotification);
  // Keep only last 50 notifications
  if (notifications.length > 50) {
    notifications = notifications.slice(0, 50);
  }
  return newNotification;
};

export const getUnreadCount = () => {
  return notifications.filter(n => !n.read).length;
};

