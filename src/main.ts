// Import necessary dependencies for the MCP (Model Context Protocol) server implementation
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
// Import transport mechanism for server communication via standard I/O
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// Import zod for runtime type validation of function parameters
import { z } from "zod";
// Import ODBC library for database connectivity
import odbc from "odbc";
// Import dotenv for loading environment variables from .env files
import dotenv from "dotenv";
// Import filesystem module for file operations
import * as fs from "fs";
// Import path module for handling file paths
import * as path from "path";
// Import utility to convert file URLs to paths
import { fileURLToPath } from "url";

// Get the current file's directory path for ES modules (as __dirname is not available by default)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads environment variables from a file and merges them with process.env
 * @param {string} filePath - Path to the .env file
 * @returns {Record<string, string>} - Combined environment variables
 */
function loadEnv(filePath: string): Record<string, string> {
    let envConfig = {};
    if (fs.existsSync(filePath)) {
        envConfig = dotenv.parse(fs.readFileSync(filePath));
    }
    return { ...envConfig, ...process.env };
}

// Load environment variables, providing defaults if not found
const myEnv = loadEnv(path.join(__dirname, ".env"));
const ODBC_DSN = myEnv.ODBC_DSN ?? "Local Virtuoso"; // Default DSN for Virtuoso
const ODBC_USER = myEnv.ODBC_USER ?? "demo";         // Default username
const ODBC_PASSWORD = myEnv.ODBC_PASSWORD ?? "demo"; // Default password
const API_KEY = myEnv.API_KEY ?? "none";             // Default API key

// Initialize the MCP server with identification info
const server = new McpServer({
    name: "MCP ODBC Server",
    version: "1.0.13"
});

/**
 * Tool to retrieve all schema names from the database
 * Parameters:
 * - user: Database username (defaults to env value)
 * - password: Database password (defaults to env value)
 * - dsn: ODBC data source name (defaults to env value)
 */
server.tool(
    "virt_get_schemas",
    `Retrieve and return a list of all schema names from the connected Virtuoso database.`,
    { user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            const catalogsResult = await connection.query("SELECT DISTINCT name_part(KEY_TABLE,0) AS CATALOG_NAME FROM DB.DBA.SYS_KEYS where __any_grants(KEY_TABLE) and table_type (KEY_TABLE) = 'TABLE' and KEY_IS_MAIN = 1 and KEY_MIGRATE_TO is NULL");
            const catalogs = catalogsResult.map(row => row.CATALOG_NAME);

            return { content: [{ type: "text", text: JSON.stringify(Array.from(new Set(catalogs)), null, 2) }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                await connection.close();
            }
        }
    }
);

server.tool(
    "get_schemas",
    `Retrieve and return a list of all schema names from the connected database.`,
    { user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            const result = await connection.tables(null, null, null, null);
            const catalogs = [...new Set(result.map(item => item.TABLE_QUALIFIER))];

            return { content: [{ type: "text", text: JSON.stringify(catalogs, null, 2) }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                await connection.close();
            }
        }
    }
);

/**
 * Tool to retrieve table information from the database
 * Parameters:
 * - schema: Optional database schema to filter tables
 * - user: Database username (defaults to env value)
 * - password: Database password (defaults to env value)
 * - dsn: ODBC data source name (defaults to env value)
 */
server.tool(
    "get_tables",
    `Retrieve and return a list containing information about tables in specified schema, if empty uses connection default`, 
    { schema: z.string().optional(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ schema = null, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Retrieve table information using ODBC tables method
            const data = await connection.tables(schema, null, null, null);
            // Return data as formatted JSON
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                await connection.close();
            }
        }
    }
);

server.tool(
    "filter_table_names",
    `Retrieve and return a list containing information about tables whose names contain the substring 'q'`,
    { q: z.string(), schema: z.string().optional(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ q, schema = null, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Retrieve table information using ODBC tables method
            const tablesInfo: TableInfo[] = [];
            const data = await connection.tables(schema, null, null, null);
            // Return data as formatted JSON
            for (const row of data) {
                if (row.TABLE_NAME.includes(q)) {
                    tablesInfo.push(row);
                }
            }
            return { content: [{ type: "text", text: JSON.stringify(tablesInfo, null, 2) }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                await connection.close();
            }
        }
    }
);

/**
 * Tool to describe the structure of a specific table
 * Parameters:
 * - schema: Database schema name (required)
 * - table: Table name to describe (required)
 * - user: Database username (optional)
 * - password: Database password (optional)
 * - dsn: ODBC data source name (optional)
 */
server.tool(
    "describe_table",
    `Retrieve and return a dictionary containing the definition of a table, including column names, data types, nullable,
     autoincrement, primary key, and foreign keys.`,
    { schema: z.string(), table: z.string(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ schema, table, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Retrieve column information for the specified table
            const data = await connection.columns(schema, null, table, null);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

/**
 * Tool to execute a custom SQL query on the database
 * Parameters:
 * - query: SQL query string to execute (required)
 * - user: Database username (optional)
 * - password: Database password (optional) 
 * - dsn: ODBC data source name (optional)
 */
server.tool(
    "query_database",
    `Execute a SQL query and return results in JSON format.`,
    { query: z.string(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ query, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Execute the provided SQL query
            const data = await connection.query(query);
            return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

server.tool(
    "query_database_md",
    `Execute a SQL query and return results in MD format.`,
    { query: z.string(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ query, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Execute the provided SQL query
            const data = await connection.query(query);

            if (data.length === 0) {
                return { content: [{ type: "text", text: "No results found." }] };
            }

            const columns = Object.keys(data[0]);
            let mdTable = `| ${columns.join(' | ')} |\n`;
            mdTable += `| ${columns.map(() => '---').join(' | ')} |\n`;

            for (let i = 0; i < data.length; i++) {
                const row = data[i];
                mdTable += `| ${columns.map(col => String(row[col] || '')).join(' | ')} |\n`;
            }

            return { content: [{ type: "text", text: mdTable }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

server.tool(
    "query_database_jsonl",
    `Execute a SQL query and return results in JSONL format.`,
    { query: z.string(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ query, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Execute the provided SQL query
            const data = await connection.query(query);

            const jsonlResults = data.map(row => JSON.stringify(row)).join("\n");

            return { content: [{ type: "text", text: jsonlResults }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

/**
 * Tool to execute a SpaSQLquery (specialized SQL/SPARQL hybrid for Virtuoso)
 * Parameters:
 * - query: SpaSQLquery to execute (required)
 * - max_rows: Maximum number of rows to return (optional)
 * - timeout: Query timeout in milliseconds (optional)
 * - user: Database username (optional)
 * - password: Database password (optional)
 * - dsn: ODBC data source name (optional)
 */
server.tool(
    "spasql_query",
    `Execute a SPASQL query and return results.`,
    {
        query: z.string(), max_rows: z.number().optional(), timeout: z.number().optional(),
        user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional()
    },
    async ({ query, max_rows = 20, timeout = 30000, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Call the execute_spasql_query stored procedure with parameters
            const data = await connection.query('select Demo.demo.execute_spasql_query(?,?,?) as result', [query, max_rows, timeout]);
            // Return just the result field from the first row
            return { content: [{ type: "text", text: data[0].result }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

/**
 * Tool to execute a SPARQL query on the Virtuoso database
 * Parameters:
 * - query: SPARQL query string (required)
 * - format: Result format (default: 'json')
 * - timeout: Query timeout in milliseconds (optional)
 * - user: Database username (optional)
 * - password: Database password (optional)
 * - dsn: ODBC data source name (optional)
 */
server.tool(
    "sparql_query",
    `Execute a SPARQL query and return results.`,
    {
        query: z.string(), format: z.string().optional(), timeout: z.number().optional(),
        user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional()
    },
    async ({ query, format = 'json', timeout = 30000, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Call the sparqlQuery function with parameters
            const data = await connection.query('select "UB".dba."sparqlQuery"(?,?,?) as result', [query, format, timeout]);
            return { content: [{ type: "text", text: data[0].result }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

/**
 * Tool to use the Virtuoso AI support function
 * Parameters:
 * - prompt: AI prompt text (required)
 * - api_key: API key for AI service (optional)
 * - user: Database username (optional)
 * - password: Database password (optional)
 * - dsn: ODBC data source name (optional)
 */
server.tool(
    "virtuoso_support_ai",
    `Tool to use the Virtuoso AI support function`,
    {
        prompt: z.string(), api_key: z.string().optional(),
        user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional()
    },
    async ({ prompt, api_key = API_KEY, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Call the OAI_VIRTUOSO_SUPPORT_AI function with prompt and API key
            const data = await connection.query('select DEMO.DBA.OAI_VIRTUOSO_SUPPORT_AI(?,?) as result', [prompt, api_key]);
            return { content: [{ type: "text", text: data[0].result }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                await connection.close();
            }
        }
    }
);

// Create a server transport mechanism using standard input/output
const transport = new StdioServerTransport();

// Connect the server to the transport to start handling requests
server.connect(transport);
