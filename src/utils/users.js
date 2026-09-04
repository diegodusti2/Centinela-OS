function publicUser(user) {
  if (!user) return null;
  const base = {
    id: user.id,
    name: user.name || user.username,
    username: user.username,
    email: user.email,
    phone: user.phone || '',
    role: user.role === 'user' ? 'client' : user.role,
    createdAt: user.created_at,
  };
  if (user.role === 'store') {
    base.storePhotoUrl = user.store_photo_url || '';
    base.storeAddress = user.store_address || '';
    base.depositBank = user.store_deposit_bank || '';
    base.depositAccount = user.store_deposit_account || '';
    base.depositHolder = user.store_deposit_holder || '';
    base.commissionRate = user.store_commission_rate ?? 20;
    base.payoutMode = user.store_payout_mode || 'store_collects';
    base.storeNotes = user.store_notes || '';
  }
  return base;
}

module.exports = { publicUser };
