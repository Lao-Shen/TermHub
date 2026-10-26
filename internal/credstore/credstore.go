// Package credstore 系统凭据存储:密码与主机密钥指纹写入
// 操作系统钥匙串(Windows 凭据管理器 / macOS Keychain / Linux Secret Service)。
// 领域无关,由桥接层以绑定形式暴露给前端。
package credstore

import (
	"errors"
	"fmt"

	"github.com/zalando/go-keyring"
)

const (
	// Service 钥匙串中的服务标识。
	Service = "termhub"

	itemPassword      = "password"
	itemHostKey       = "hostkey"
	itemProxyPassword = "proxypassword"
	itemProxyHostKey  = "proxyhostkey"
)

// Store 凭据存储入口。
type Store struct{}

// New 构造凭据存储。
func New() *Store {
	return &Store{}
}

// SetPassword 保存连接密码。
func (s *Store) SetPassword(connID, password string) error {
	return wrap(keyring.Set(Service, user(connID, itemPassword), password))
}

// GetPassword 读取连接密码;未保存返回空串与 nil。
func (s *Store) GetPassword(connID string) (string, error) {
	return s.get(connID, itemPassword)
}

// DeletePassword 删除连接密码(不存在视为成功)。
func (s *Store) DeletePassword(connID string) error {
	return s.delete(connID, itemPassword)
}

// SetTrustedHostKey 保存已信任的主机密钥指纹。
func (s *Store) SetTrustedHostKey(connID, fingerprint string) error {
	return wrap(keyring.Set(Service, user(connID, itemHostKey), fingerprint))
}

// GetTrustedHostKey 读取已信任指纹;未保存返回空串与 nil。
func (s *Store) GetTrustedHostKey(connID string) (string, error) {
	return s.get(connID, itemHostKey)
}

// DeleteTrustedHostKey 删除已信任指纹。
func (s *Store) DeleteTrustedHostKey(connID string) error {
	return s.delete(connID, itemHostKey)
}

// SetProxyPassword 保存跳板机密码。
func (s *Store) SetProxyPassword(connID, password string) error {
	return wrap(keyring.Set(Service, user(connID, itemProxyPassword), password))
}

// GetProxyPassword 读取跳板机密码;未保存返回空串与 nil。
func (s *Store) GetProxyPassword(connID string) (string, error) {
	return s.get(connID, itemProxyPassword)
}

// DeleteProxyPassword 删除跳板机密码。
func (s *Store) DeleteProxyPassword(connID string) error {
	return s.delete(connID, itemProxyPassword)
}

// SetProxyTrustedHostKey 保存跳板机主机密钥指纹。
func (s *Store) SetProxyTrustedHostKey(connID, fingerprint string) error {
	return wrap(keyring.Set(Service, user(connID, itemProxyHostKey), fingerprint))
}

// GetProxyTrustedHostKey 读取跳板机指纹;未保存返回空串与 nil。
func (s *Store) GetProxyTrustedHostKey(connID string) (string, error) {
	return s.get(connID, itemProxyHostKey)
}

// DeleteProxyTrustedHostKey 删除跳板机指纹。
func (s *Store) DeleteProxyTrustedHostKey(connID string) error {
	return s.delete(connID, itemProxyHostKey)
}

// DeleteAll 删除连接的全部凭据(删除连接时调用,尽力而为)。
func (s *Store) DeleteAll(connID string) {
	_ = s.DeletePassword(connID)
	_ = s.DeleteTrustedHostKey(connID)
	_ = s.DeleteProxyPassword(connID)
	_ = s.DeleteProxyTrustedHostKey(connID)
}

func (s *Store) get(connID, item string) (string, error) {
	v, err := keyring.Get(Service, user(connID, item))
	if errors.Is(err, keyring.ErrNotFound) {
		return "", nil
	}
	if err != nil {
		return "", wrap(err)
	}
	return v, nil
}

func (s *Store) delete(connID, item string) error {
	err := keyring.Delete(Service, user(connID, item))
	if errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return wrap(err)
}

func user(connID, item string) string {
	return connID + "/" + item
}

func wrap(err error) error {
	if err == nil {
		return nil
	}
	return fmt.Errorf("系统凭据存储操作失败: %w", err)
}
