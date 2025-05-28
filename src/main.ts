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
    version: "1.0.14"
});

function dataToMD (data: any) {
    if (data.length === 0)
        return "No results found.";
    const columns = Object.keys(data[0]);
    let mdTable = `| ${columns.join(' | ')} |\n`;
    mdTable += `| ${columns.map(() => '---').join(' | ')} |\n`;

    for (let i = 0; i < data.length; i++) {
        const row = data[i];
        mdTable += `| ${columns.map(col => String(row[col] || '')).join(' | ')} |\n`;
    }
    return mdTable;
}


// Define interface for the table structure returned by ODBC
interface OdbcTableRow {
  TABLE_QUALIFIER?: string;
  TABLE_OWNER?: string;
  TABLE_NAME: string;
  [key: string]: any; // For other properties that might exist
}

async function supportsCatalogs(connection: odbc.Connection): Promise<boolean> {
    try{
        const cats = await connection.tables('%', "", "", null) as OdbcTableRow[];
        if (cats.length && cats[0].TABLE_QUALIFIER)
            return true;
        else
            return false;
    } catch (_) {
        return false;
    }
}


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
    { user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional(), format: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            const catalogs = await connection.query("SELECT DISTINCT name_part(KEY_TABLE,0) AS CATALOG_NAME FROM DB.DBA.SYS_KEYS where __any_grants(KEY_TABLE) and table_type (KEY_TABLE) = 'TABLE' and KEY_IS_MAIN = 1 and KEY_MIGRATE_TO is NULL");
            let tool_result;
            if ('jsonl' === format)
                tool_result = catalogs.map(row => JSON.stringify(row)).join("\n");
            else if ('md' === format)
                tool_result = dataToMD(catalogs);
            else
                tool_result = JSON.stringify(catalogs, null, 2);

            return { content: [{ type: "text", text: tool_result }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
            }
        }
    }
);

server.tool(
    "get_schemas",
    `Retrieve and return a list of all schema names from the connected database.`,
    { user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional(), format: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            const has_catalogs = await supportsCatalogs(connection);
            const result = has_catalogs ? await connection.tables('%', "", "", null)
                                        : await connection.tables(null, '%', "", null)
            let cat_name = "TABLE_CAT"
            if (result && result.length) {
                let row = result[0] as Record<string, any>;
                if (has_catalogs)
                    cat_name = "TABLE_CAT" in row ? "TABLE_CAT" : "TABLE_QUALIFIER";
                else
                    cat_name = 'TABLE_SCHEM' in row ? "TABLE_SCHEM" : "TABLE_OWNER";
            }
            const catalogs = [...new Set(result.map((item: any) => item[cat_name]))].map(name => ({ CATALOG_NAME: name }))

            let tool_result;
            if ('jsonl' === format)
                tool_result = catalogs.map(row => JSON.stringify(row)).join("\n");
            else if ('md' === format)
                tool_result = dataToMD(catalogs);
            else
                tool_result = JSON.stringify(catalogs, null, 2);
            return { content: [{ type: "text", text: tool_result }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
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
    { schema: z.string().optional(), user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ schema = null, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Retrieve table information using ODBC tables method
            const has_catalogs = await supportsCatalogs(connection);
            const data = has_catalogs ? await connection.tables(schema, null, null, null)
                                      : await connection.tables(null, schema, null, null);
            // Return data as formatted JSON
            let tool_result;
            if ('jsonl' === format)
                tool_result = data.map(row => JSON.stringify(row)).join("\n");
            else if ('md' === format)
                tool_result = dataToMD(data);
            else
                tool_result = JSON.stringify(data, null, 2);
            return { content: [{ type: "text", text: tool_result }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
            }
        }
    }
);

server.tool(
    "filter_table_names",
    `Retrieve and return a list containing information about tables whose names contain the substring 'q'`,
    { q: z.string(), schema: z.string().optional(), user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ q, schema = null, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
        let connection;
        try {
            // Establish database connection using provided credentials
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Retrieve table information using ODBC tables method
            const has_catalogs = await supportsCatalogs(connection)
            const tablesInfo: any = [];
            schema = schema || '%';
            const data = has_catalogs ? await connection.tables(schema, null, '%', null)
                                      : await connection.tables(null, schema, '%', null);
            // Return data as formatted JSON
            for (const row of data) {
                if ((row as any).TABLE_NAME.includes(q)) {
                    tablesInfo.push(row);
                }
            }
            let tool_result;
            if ('jsonl' === format)
                tool_result = tablesInfo.map((row: any) => JSON.stringify(row)).join("\n");
            else if ('md' === format)
                tool_result = dataToMD(tablesInfo);
            else
                tool_result = JSON.stringify(tablesInfo, null, 2);
            return { content: [{ type: "text", text: tool_result }] };
        } catch (error) {
            // Return error information if any exception occurs
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            // Ensure connection is closed even if an error occurs
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
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
    { schema: z.string(), table: z.string(), user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ schema, table, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Retrieve column information for the specified table
            const has_catalogs = await supportsCatalogs(connection)
            const data = has_catalogs ? await connection.columns(schema, null, table, null)
                                      : await connection.columns(null, schema, table, null);
            let tool_result;
            if ('jsonl' === format)
                tool_result = data.map(row => JSON.stringify(row)).join("\n");
            else if ('md' === format)
                tool_result = dataToMD(data);
            else
                tool_result = JSON.stringify(data, null, 2);
            return { content: [{ type: "text", text: tool_result }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
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
 * - format: one of json/jsonl/md
 */
async function query_database(query: string, user: string, password: string, dsn: string, format: string): Promise<any> {
    let connection;
    try {
        // Establish database connection
        connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
        // Execute the provided SQL query
        const data = await connection.query(query);
        let tool_result;
        if ('jsonl' === format)
            tool_result = data.map(row => JSON.stringify(row)).join("\n");
        else if ('md' === format)
            tool_result = dataToMD(data);
        else
            tool_result = JSON.stringify(data, null, 2);
        return { content: [{ type: "text", text: tool_result }] };
    } catch (error) {
        return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
    } finally {
        if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
        }
    }
}

server.tool(
    "query_database",
    `Execute a SQL query and return results in JSON, JSONL or MD format.`,
    { query: z.string(), user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ query, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
       return query_database (query, user, password, dsn, format);
    }
);

server.tool(
    "query_database_md",
    `Execute a SQL query and return results in MD format.`,
    { query: z.string(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ query, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
       return query_database (query, user, password, dsn, "md");
    }
);

server.tool(
    "query_database_jsonl",
    `Execute a SQL query and return results in JSONL format.`,
    { query: z.string(), user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional() },
    async ({ query, user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
       return query_database (query, user, password, dsn, "jsonl");
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
        query: z.string(), max_rows: z.number().optional(), timeout: z.number().optional(), format: z.string().optional(),
        user: z.string().optional(), password: z.string().optional(), dsn: z.string().optional()
    },
    async ({ query, max_rows = 20, timeout = 30000, format = 'json', user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN }) => {
        let connection;
        try {
            // Establish database connection
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            // Call the execute_spasql_query stored procedure with parameters
            type ResultRow = { result: string };
            const data = await connection.query('select Demo.demo.execute_spasql_query(?,?,?,?) as result', [query, max_rows, timeout, format]);
            // Return just the result field from the first row
            return { content: [{ type: "text", text: (data[0] as ResultRow).result }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
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
            type ResultRow = { result: string };
            return { content: [{ type: "text", text: (data[0] as ResultRow).result }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
            }
        }
    }
);

server.tool(
    "sparql_get_entity_types",
    `This query retrieves all entity types in the RDF graph, along with their labels and comments if available.
     It filters out blank nodes and ensures that only IRI types are returned.
     The LIMIT clause is set to 100 to restrict the number of entity types returned.`,
    { user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
    const query = `SELECT DISTINCT * FROM (
        SPARQL
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?o
        WHERE {
            GRAPH ?g {
                ?s a ?o .

                OPTIONAL {
                    ?s rdfs:label ?label .
                    FILTER (LANG(?label) = "en" || LANG(?label) = "")
                }

                OPTIONAL {
                    ?s rdfs:comment ?comment .
                    FILTER (LANG(?comment) = "en" || LANG(?comment) = "")
                }

                FILTER (isIRI(?o) && !isBlank(?o))
            }
        }
        LIMIT 100
    ) AS x`;
       return query_database (query, user, password, dsn, format);
    }
);

server.tool(
    "sparql_get_entity_types_detailed",
    `This query retrieves all entity types in the RDF graph, along with their labels and comments if available.
    It filters out blank nodes and ensures that only IRI types are returned.
    The LIMIT clause is set to 100 to restrict the number of entity types returned.`,
    { user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
    const query = `
        SELECT * FROM (
            SPARQL
            PREFIX owl: <http://www.w3.org/2002/07/owl#>
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

            SELECT ?o, (SAMPLE(?label) AS ?label), (SAMPLE(?comment) AS ?comment)
            WHERE {
                GRAPH ?g {
                    ?s a ?o .
                    OPTIONAL {?o rdfs:label ?label . FILTER (LANG(?label) = "en" || LANG(?label) = "")}
                    OPTIONAL {?o rdfs:comment ?comment . FILTER (LANG(?comment) = "en" || LANG(?comment) = "")}
                    FILTER (isIRI(?o) && !isBlank(?o))
                }
            }
            GROUP BY ?o
            ORDER BY ?o
            LIMIT 20
        ) AS results
    `;
       return query_database (query, user, password, dsn, format);
    }
);

server.tool(
    "sparql_get_entity_types_samples",
    `This query retrieves samples of entities for each type in the RDF graph, along with their labels and counts.
    It groups by entity type and orders the results by sample count in descending order.
    Note: The LIMIT clause is set to 20 to restrict the number of entity types returned.
    `,
    { user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
    const query = `
        SELECT * FROM (
            SPARQL
            PREFIX owl: <http://www.w3.org/2002/07/owl#>
            PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
            PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
            SELECT (SAMPLE(?s) AS ?sample), ?slabel, (COUNT(*) AS ?sampleCount), (?o AS ?entityType), ?olabel
            WHERE {
                GRAPH ?g {
                    ?s a ?o .
                    OPTIONAL {?s rdfs:label ?slabel . FILTER (LANG(?slabel) = "en" || LANG(?slabel) = "")}
                    FILTER (isIRI(?s) && !isBlank(?s))
                    OPTIONAL {?o rdfs:label ?olabel . FILTER (LANG(?olabel) = "en" || LANG(?olabel) = "")}
                    FILTER (isIRI(?o) && !isBlank(?o))
                }
            }
            GROUP BY ?slabel ?o ?olabel
            ORDER BY DESC(?sampleCount) ?o ?slabel ?olabel
            LIMIT 20
        ) AS results
    `;
       return query_database (query, user, password, dsn, format);
    }
);

server.tool(
    "sparql_get_ontologies",
    `This query retrieves all ontologies in the RDF graph, along with their labels and comments if available.`,
    { user: z.string().optional(), password: z.string().optional(),
        dsn: z.string().optional(), format: z.string().optional() },
    async ({ user = ODBC_USER, password = ODBC_PASSWORD, dsn = ODBC_DSN, format = 'json' }) => {
    const query = `
    SELECT * FROM (
        SPARQL
        DEFINE input:storage ""
        PREFIX owl: <http://www.w3.org/2002/07/owl#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?s, ?label, ?comment
        WHERE {
            GRAPH ?g {
                ?s a owl:Ontology .
                OPTIONAL {
                    ?s rdfs:label ?label .
                    FILTER (LANG(?label) = "en" || LANG(?label) = "")
                }
                OPTIONAL {
                    ?s rdfs:comment ?comment .
                    FILTER (LANG(?comment) = "en" || LANG(?comment) = "")
                }
                FILTER (isIRI(?s) && !isBlank(?s))
            }
        }
        LIMIT 100
    ) AS x
    `;
       return query_database (query, user, password, dsn, format);
    }
);

server.tool(
    "chat_prompt_complete",
    `Tool to use the OPAL backend to complete chat prompt`,
    {
        model: z.string(),
        prompt: z.string(),
        assistant_config_id: z.string().optional(),
        function_names: z.string().optional(),
        temperature: z.number().optional(),
        top_p: z.number().optional(),
        max_tokens: z.number().optional(),
        api_key: z.string().optional(),
        user: z.string().optional(),
        password: z.string().optional(),
        dsn: z.string().optional()
    },
    async ({ model,
             prompt,
             assistant_config_id = null,
             function_names = null,
             temperature = 0.2,
             top_p = 0.5,
             max_tokens = null,
             api_key = API_KEY,
             user = ODBC_USER,
             password = ODBC_PASSWORD,
             dsn = ODBC_DSN }) => {
        let connection;
        try {
            connection = await odbc.connect(`DSN=${dsn};UID=${user};PWD=${password}`);
            const data = await connection.query('select OAI.DBA.chatPromptComplete(?,?,?,?,?,?,?,?) as result', 
                  [model, prompt, assistant_config_id as any, function_names as any, temperature, top_p, max_tokens as any, api_key]);
            type ResultRow = { result: string };
            return { content: [{ type: "text", text: (data[0] as ResultRow).result }] };
        } catch (error) {
            return { content: [{ type: "text", text: `Error: ${JSON.stringify(error, null, 2)}` }], isError: true };
        } finally {
            if (connection) {
                try {
                    await connection.close();
                } catch (_) {}
            }
        }
    }
);

// Create a server transport mechanism using standard input/output
const transport = new StdioServerTransport();

// Connect the server to the transport to start handling requests
server.connect(transport);
