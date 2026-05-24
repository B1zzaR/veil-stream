package ws

import (
	"encoding/json"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gofiber/websocket/v2"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	sendBuf        = 64
	maxMessageSize = 1024 * 1024 // 1MB defensive limit on inbound payloads
)

type Client struct {
	id     uint64
	conn   *websocket.Conn
	send   chan []byte
	hub    *Hub
	closed atomic.Bool
}

type Hub struct {
	mu      sync.RWMutex
	clients map[uint64]*Client
	nextID  uint64
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[uint64]*Client),
	}
}

func (h *Hub) Register(conn *websocket.Conn) *Client {
	h.mu.Lock()
	h.nextID++
	id := h.nextID
	c := &Client{
		id:   id,
		conn: conn,
		send: make(chan []byte, sendBuf),
		hub:  h,
	}
	h.clients[id] = c
	h.mu.Unlock()
	return c
}

// Unregister is safe to call multiple times.
func (h *Hub) Unregister(c *Client) {
	if !c.closed.CompareAndSwap(false, true) {
		return
	}
	h.mu.Lock()
	delete(h.clients, c.id)
	close(c.send)
	h.mu.Unlock()
}

func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}

func (h *Hub) Broadcast(msgType string, payload interface{}) {
	data, err := json.Marshal(map[string]interface{}{
		"type":    msgType,
		"payload": payload,
	})
	if err != nil {
		log.Printf("ws: marshal error: %v", err)
		return
	}

	// Snapshot clients under read lock to release the lock quickly.
	h.mu.RLock()
	clients := make([]*Client, 0, len(h.clients))
	for _, c := range h.clients {
		clients = append(clients, c)
	}
	h.mu.RUnlock()

	for _, c := range clients {
		if c.closed.Load() {
			continue
		}
		select {
		case c.send <- data:
		default:
			// Slow client — drop and disconnect to free resources.
			log.Printf("ws: slow client %d, dropping", c.id)
			go h.Unregister(c)
		}
	}
}

// WritePump owns the connection's write side. Sends periodic pings.
func (c *Client) WritePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ReadPump consumes incoming frames (clients don't send real data, but we need to
// drain pongs/closes for the connection to stay healthy).
func (c *Client) ReadPump() {
	defer c.hub.Unregister(c)

	c.conn.SetReadLimit(maxMessageSize)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}
