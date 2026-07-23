import { EnvVarDefinition } from '@snstac/cockpit-shared';

// Configuration schema for /etc/default/sapientcot (SAPIENTCOT: SAPIENT BSI Flex
// 335 sensor detections -> CoT). Reads a SAPIENT Fusion/HLDMM node over TCP.
export const CONF_PARAMS: Record<string, EnvVarDefinition> = {

    COT_URL: {
        type: 'url',
        description: 'URL of the CoT destination, typically Mesh SA or a TAK Server',
        defaultValue: 'udp+wo://239.2.3.1:6969',
        validation: /^(udp\+wo|http|https|udp|tcp|tls|file|log|tcp\+wo|udp\+broadcast):\/\/[^\s]+$/,
        requiresQuoting: false,
        required: true,
    },

    SAPIENT_HOST: {
        type: 'string',
        description: 'SAPIENT Fusion / HLDMM node (or middleware) to read detections from',
        defaultValue: '127.0.0.1',
        validation: /^[\w.-]+$/,
        requiresQuoting: false,
        required: true,
    },

    SAPIENT_PORT: {
        type: 'number',
        description: 'SAPIENT node TCP port',
        defaultValue: '5010',
        validation: /^\d{1,5}$/,
        range: [1, 65535],
        required: false,
    },

    SAPIENT_VERSION: {
        type: 'enum',
        description: 'SAPIENT standard version',
        defaultValue: 'v2',
        options: ['v2', 'v1'],
        validation: /^v[12]$/,
        required: false,
    },

    COT_TYPE: {
        type: 'string',
        description: 'Force a single CoT type for every detection (blank = map by classification: air/ground/sea)',
        defaultValue: '',
        validation: /^(a-[a-z](-[A-Za-z0-9]+)+)?$/,
        requiresQuoting: false,
        required: false,
    },

    COT_STALE: {
        type: 'number',
        description: 'CoT stale period ("timeout"), in seconds (detections are transient)',
        defaultValue: '60',
        validation: /^\d+$/,
        range: [1, 86400],
        required: false,
    },

    SAPIENT_LEN_BYTES: {
        type: 'number',
        description: 'Frame length-prefix size in bytes (standard = 4; change only for a non-standard peer)',
        defaultValue: '4',
        validation: /^[1-8]$/,
        range: [1, 8],
        required: false,
    },

    SAPIENT_LEN_ENDIAN: {
        type: 'enum',
        description: 'Frame length-prefix endianness (SAPIENT standard = little)',
        defaultValue: 'little',
        options: ['little', 'big'],
        validation: /^(little|big)$/,
        required: false,
    },

    TAK_PROTO: {
        type: 'enum',
        description: 'TAK protocol for CoT output (0=XML, 1=Proto Stream, 2=Proto Mesh)',
        defaultValue: '0',
        options: ['0', '1', '2'],
        validation: /^[012]$/,
        required: false,
    },

    PYTAK_TLS_CLIENT_CERT: {
        type: 'path',
        description: '(TLS) PEM client certificate for tls:// TAK Server destinations',
        defaultValue: '',
        validation: /^(\/[^\s]*)?$/,
        requiresQuoting: false,
        required: false,
    },

    PYTAK_TLS_CLIENT_KEY: {
        type: 'path',
        description: '(TLS) PEM client private key, if separate from the certificate',
        defaultValue: '',
        validation: /^(\/[^\s]*)?$/,
        requiresQuoting: false,
        required: false,
    },

    DEBUG: {
        type: 'boolean',
        description: 'Enable debug-level logging',
        defaultValue: 'false',
        validation: /^(true|false|0|1)?$/i,
        required: false,
    },
};
