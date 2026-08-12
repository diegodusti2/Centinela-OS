function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name || user.username,
    username: user.username,
    email: user.email,
    phone: user.phone || '',
    role: user.role === 'user' ? 'client' : user.role,
    createdAt: user.created_at,
  };
}

module.exports = { publicUser };
