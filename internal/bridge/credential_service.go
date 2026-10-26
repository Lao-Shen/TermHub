package bridge

import (
	"termhub/internal/credstore"
)

// CredentialService 凭据绑定服务:密码与主机密钥指纹的系统钥匙串存取。
// 前端不在 localStorage/sessionStorage 保存任何秘密。
type CredentialService struct {
	store *credstore.Store
}

// NewCredentialService 构造凭据服务。
func NewCredentialService(store *credstore.Store) *CredentialService {
	return &CredentialService{store: store}
}

// SetPassword 保存连接密码(明文仅在进程内出现,落库由系统钥匙串加密)。
func (s *CredentialService) SetPassword(connID, password string) error {
	return s.store.SetPassword(connID, password)
}

// GetPassword 读取连接密码;未保存返回空串。
func (s *CredentialService) GetPassword(connID string) (string, error) {
	return s.store.GetPassword(connID)
}

// DeletePassword 删除连接密码。
func (s *CredentialService) DeletePassword(connID string) error {
	return s.store.DeletePassword(connID)
}

// SetTrustedHostKey 保存已信任的主机密钥指纹。
func (s *CredentialService) SetTrustedHostKey(connID, fingerprint string) error {
	return s.store.SetTrustedHostKey(connID, fingerprint)
}

// GetTrustedHostKey 读取已信任指纹;未保存返回空串。
func (s *CredentialService) GetTrustedHostKey(connID string) (string, error) {
	return s.store.GetTrustedHostKey(connID)
}

// DeleteTrustedHostKey 删除已信任指纹。
func (s *CredentialService) DeleteTrustedHostKey(connID string) error {
	return s.store.DeleteTrustedHostKey(connID)
}

// SetProxyPassword 保存跳板机密码。
func (s *CredentialService) SetProxyPassword(connID, password string) error {
	return s.store.SetProxyPassword(connID, password)
}

// GetProxyPassword 读取跳板机密码;未保存返回空串。
func (s *CredentialService) GetProxyPassword(connID string) (string, error) {
	return s.store.GetProxyPassword(connID)
}

// DeleteProxyPassword 删除跳板机密码。
func (s *CredentialService) DeleteProxyPassword(connID string) error {
	return s.store.DeleteProxyPassword(connID)
}

// SetProxyTrustedHostKey 保存跳板机主机密钥指纹。
func (s *CredentialService) SetProxyTrustedHostKey(connID, fingerprint string) error {
	return s.store.SetProxyTrustedHostKey(connID, fingerprint)
}

// GetProxyTrustedHostKey 读取跳板机指纹;未保存返回空串。
func (s *CredentialService) GetProxyTrustedHostKey(connID string) (string, error) {
	return s.store.GetProxyTrustedHostKey(connID)
}

// DeleteProxyTrustedHostKey 删除跳板机指纹。
func (s *CredentialService) DeleteProxyTrustedHostKey(connID string) error {
	return s.store.DeleteProxyTrustedHostKey(connID)
}
