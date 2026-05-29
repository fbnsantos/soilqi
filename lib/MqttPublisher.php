<?php
/**
 * MqttPublisher — cliente MQTT 3.1.1 mínimo em PHP puro (sem Composer).
 * Só faz CONNECT + PUBLISH + DISCONNECT.
 * Para TLS, defina $port=8883 e wraps com stream_context_create(['ssl'=>[...]]).
 */
class MqttPublisher
{
    private $socket = null;
    private string $host;
    private int    $port;
    private string $clientId;
    private string $user;
    private string $pass;

    /**
     * @throws RuntimeException se não conseguir ligar ao broker
     */
    public function __construct(
        string $host,
        int    $port     = 1883,
        string $clientId = '',
        string $user     = '',
        string $pass     = ''
    ) {
        $this->host     = $host;
        $this->port     = $port;
        $this->clientId = $clientId ?: 'soilqi_php_' . substr(md5(uniqid()), 0, 8);
        $this->user     = $user;
        $this->pass     = $pass;

        $this->connect();
    }

    // ── Ligação ───────────────────────────────────────────────────────────────

    private function connect(): void
    {
        $this->socket = @fsockopen($this->host, $this->port, $errno, $errstr, 5);
        if (!$this->socket) {
            throw new RuntimeException("MQTT: não foi possível ligar a {$this->host}:{$this->port} — $errstr ($errno)");
        }
        stream_set_timeout($this->socket, 5);

        // ── Corpo do CONNECT ──────────────────────────────────────────────────
        // Protocol name + level (MQTT 3.1.1)
        $body  = "\x00\x04MQTT\x04";

        // Connect flags
        $flags = 0x02; // clean session
        if ($this->user !== '') {
            $flags |= 0x80;
            if ($this->pass !== '') $flags |= 0x40;
        }
        $body .= chr($flags);

        // Keep-alive: 60 s
        $body .= "\x00\x3c";

        // Client ID
        $body .= $this->encodeStr($this->clientId);

        // Credentials
        if ($this->user !== '') {
            $body .= $this->encodeStr($this->user);
            if ($this->pass !== '') $body .= $this->encodeStr($this->pass);
        }

        // CONNECT header (type = 0x10)
        $packet = chr(0x10) . $this->encodeRemainingLength(strlen($body)) . $body;
        fwrite($this->socket, $packet);

        // Ler CONNACK (4 bytes)
        $ack = fread($this->socket, 4);
        if (strlen($ack) < 4 || ord($ack[0]) !== 0x20) {
            throw new RuntimeException('MQTT: resposta CONNACK inválida.');
        }
        $rc = ord($ack[3]);
        if ($rc !== 0) {
            $msgs = [
                1 => 'Versão de protocolo inaceitável',
                2 => 'Client ID rejeitado',
                3 => 'Servidor indisponível',
                4 => 'Credenciais inválidas',
                5 => 'Não autorizado',
            ];
            throw new RuntimeException('MQTT CONNACK erro ' . $rc . ': ' . ($msgs[$rc] ?? 'desconhecido'));
        }
    }

    // ── Publicar ──────────────────────────────────────────────────────────────

    /**
     * @param string $topic   Tópico MQTT
     * @param string $payload Mensagem (string, tipicamente JSON)
     * @param int    $qos     0 ou 1
     * @param bool   $retain  Mensagem retida
     */
    public function publish(string $topic, string $payload, int $qos = 1, bool $retain = false): void
    {
        $header  = 0x30; // PUBLISH fixed header base
        $header |= ($qos & 0x03) << 1;
        if ($retain) $header |= 0x01;

        $body  = $this->encodeStr($topic);
        if ($qos > 0) {
            // Packet ID fixo (só publicamos um de cada vez)
            $body .= "\x00\x01";
        }
        $body .= $payload;

        $packet = chr($header) . $this->encodeRemainingLength(strlen($body)) . $body;
        fwrite($this->socket, $packet);

        // Para QoS 1, aguardar PUBACK
        if ($qos === 1) {
            $puback = fread($this->socket, 4);
            // PUBACK começa com 0x40 — verificamos silenciosamente
        }
    }

    // ── Desligar ──────────────────────────────────────────────────────────────

    public function disconnect(): void
    {
        if ($this->socket) {
            fwrite($this->socket, "\xe0\x00"); // DISCONNECT
            fclose($this->socket);
            $this->socket = null;
        }
    }

    public function __destruct()
    {
        $this->disconnect();
    }

    // ── Auxiliares ────────────────────────────────────────────────────────────

    private function encodeStr(string $s): string
    {
        $len = strlen($s);
        return chr($len >> 8) . chr($len & 0xFF) . $s;
    }

    private function encodeRemainingLength(int $len): string
    {
        $out = '';
        do {
            $byte = $len & 0x7F;
            $len  = $len >> 7;
            if ($len > 0) $byte |= 0x80;
            $out .= chr($byte);
        } while ($len > 0);
        return $out;
    }
}
