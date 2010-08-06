var log = require('ringo/logging').getLogger(module.id);

export("close", "createTable", "createSequence", "getColumns", "getPrimaryKeys", "getTables", "tableExists", "dropTable", "dropSequence");

/**
 * Utility function for closing DB connections, resultsets et.al.
 * @param {Object} obj The object to close
 */
function close(obj) {
    if (obj != null) {
        obj.close();
    }
};

/**
 * Creates a table
 * @param {Store} store The store to create the table for
 * @param {String} tableName The name of the table to create
 * @param {Array} columns An array containing column definitions
 * @param {Array} primaryKey An array containing the primary key columns
 * @param {String} engineType Optional engine type, solely for mysql databases
 * @returns The result as received from the database
 */
function createTable(conn, dialect, tableName, columns, primaryKey) {
    var sqlBuf = new java.lang.StringBuffer();
    sqlBuf.append("CREATE TABLE ").append(dialect.quote(tableName));
    sqlBuf.append(" (");
    
    columns.forEach(function(column, idx) {
        var dataType = dialect.getColumnType(column.type);
        if (!dataType) {
            throw new Error("Unable to determine data type, code: " + column.type);
        }
        sqlBuf.append(dialect.quote(column.name));
        sqlBuf.append(" ").append(dataType.getSql(column.length, column.precision, column.scale));
        // default column value
        if (column["default"] != null) {
            sqlBuf.append(" DEFAULT ");
            if (dataType.needsQuotes() === true) {
                sqlBuf.append(dataType.quote(column["default"]));
            } else {
                sqlBuf.append(column["default"].toString());
            }
        }
        // null not allowed in column
        if (column.nullable === false) {
            sqlBuf.append(" NOT NULL");
        }
        if (idx < columns.length -1) {
            sqlBuf.append(", ");
        }
    }, this);

    // primary key
    if (primaryKey != null) {
        if (typeof(primaryKey) === "string") {
            primaryKey = [primaryKey];
        }
        sqlBuf.append(", PRIMARY KEY (");
        sqlBuf.append(primaryKey.map(function(name) {
            return dialect.quote(name);
        }).join(", ")).append(")");
    }
    sqlBuf.append(")");
    var engineType = dialect.getEngineType();
    if (engineType != null) {
        sqlBuf.append(" ENGINE=").append(engineType);
    }
    log.info("createTable: " + sqlBuf.toString());

    var statement = null;
    try {
        conn.setReadOnly(false);
        statement = conn.createStatement();
        return statement.executeUpdate(sqlBuf.toString());
    } finally {
        close(statement);
        close(conn);
    }
};

function createSequence(conn, dialect, sequenceName) {
    var sqlBuf = new java.lang.StringBuffer("CREATE SEQUENCE ");
    sqlBuf.append(dialect.quote(sequenceName));
    sqlBuf.append(" START WITH 1 INCREMENT BY 1");
    log.info("createSequence: " + sqlBuf.toString());
    var statement = null;
    try {
        conn.setReadOnly(false);
        statement = conn.createStatement();
        return statement.executeUpdate(sqlBuf.toString());
    } finally {
        close(statement);
        close(conn);
    }
};



/**
 * Returns the columns of a given table
 * @param {java.sql.DatabaseMetadata} dbMetaData The database metadata
 * @param {String} tablePattern Optional table name pattern (defaults to "%")
 * @param {String} schemaPattern Optional schema name pattern (defaults to "%")
 * @param {String} columnPattern Optional column name pattern (defaults to "%")
 * @returns An array containing the column metadata
 * @type Array
 */
function getColumns(dbMetaData, tablePattern, schemaPattern, columnPattern) {
    var result = [];
    var columnMetaData = null;
    try {
        columnMetaData = dbMetaData.getColumns(null, schemaPattern || "%",
                tablePattern || "%", columnPattern || "%");
        while (columnMetaData.next()) {
            result.push({
                "name": columnMetaData.getString("COLUMN_NAME"),
                "type": columnMetaData.getInt("DATA_TYPE"),
                "length": columnMetaData.getInt("COLUMN_SIZE"),
                "nullable": (columnMetaData.getInt("NULLABLE") == dbMetaData.typeNoNulls) ? false : true,
                "default": columnMetaData.getString("COLUMN_DEF"),
                "precision": columnMetaData.getInt("DECIMAL_DIGITS"),
                "scale": columnMetaData.getInt("NUM_PREC_RADIX")
             });
        }
        return result;
    } finally {
        close(columnMetaData);
    }
};

/**
 * Returns the primary keys of a given table
 * @param {java.sql.DatabaseMetadata} dbMetaData The database metadata
 * @param {String} tableName The name of the table
 * @param {String} schemaName Optional schema name
 * @returns An array containing the table's primary keys
 * @type Array
 */
function getPrimaryKeys(dbMetaData, tableName, schemaName) {
    var result = [];
    var keyMetaData = null;
    try {
        keyMetaData = dbMetaData.getPrimaryKeys(null, schemaName || null, tableName);
        while (keyMetaData.next()) {
            result.push({
                "name": keyMetaData.getString("COLUMN_NAME"),
                "sequenceNumber": keyMetaData.getShort("KEY_SEQ"),
                "primaryKeyName": keyMetaData.getString("PK_NAME")
            });
        }
        return result;
    } finally {
        close(keyMetaData);
    }
};

/**
 * Returns the tables defined. Note that this method does not close the
 * connection passed as argument.
 * @param {java.sql.Connection} conn The connection to use
 * @returns The tables
 * @type Array
 */
function getTables(conn) {
    var result = [];
    var metaData = null;
    var tableMetaData = null;
    try {
        metaData = conn.getMetaData();
        tableMetaData = metaData.getTables(null, "%", "%", ["TABLE"]);
        while (tableMetaData.next()) {
            var tableName = tableMetaData.getString("TABLE_NAME");
            var schemaName = tableMetaData.getString("TABLE_SCHEM");
            result.push({
                "name": tableName,
                "schema": schemaName,
                "catalog": tableMetaData.getString("TABLE_CAT"),
                "type": tableMetaData.getString("TABLE_TYPE"),
                "columns": getColumns(metaData, tableName, schemaName),
                "primaryKeys": getPrimaryKeys(metaData, tableName, schemaName)
            });
        }
        return result;
    } finally {
        close(tableMetaData);
        close(conn);
    }
};

/**
 * Returns true if the database has a table with the given name
 * @param {String} tableName The name of the table
 * @returns True if the table exists, false otherwise
 * @type Boolean
 */
function tableExists(conn, tableName) {
    return getTables(conn).map(function(table) {
        return table.name;
    }).indexOf(tableName) > -1;
};

/**
 * Drops the table with the given name
 * @param {java.sql.Connection} conn The connection to use
 * @param {String} tableName The name of the table
 * @param {String} schemaName Optional schema name
 */
function dropTable(conn, dialect, tableName, schemaName) {
    return drop(conn, dialect, "TABLE", tableName, schemaName);
};

/**
 * Drops the sequence with the given name
 * @param {java.sql.Connection} conn The connection to use
 * @param {String} sequenceName The name of the sequence to drop
 * @param {String} schemaName Optional schema name
 */
function dropSequence(conn, dialect, sequenceName, schemaName) {
    return drop(conn, dialect, "SEQUENCE", sequenceName, schemaName);
};

/**
 * Generic function for dropping database objects
 * @param {java.sql.Connection} conn The connection to use
 * @param {String} typeName The type of the database object to drop
 * (eg. "TABLE", "SEQUENCE")
 * @param {String} objectName The name of the database object to drop
 * @param {String} schemaName Optional schema name
 * @private
 */
function drop(conn, dialect, typeName, objectName, schemaName) {
    var sqlBuf = new java.lang.StringBuffer("DROP ");
    sqlBuf.append(typeName).append(" ");
    if (schemaName != null) {
        sqlBuf.append(dialect.quote(schemaName)).append(".");
    }
    sqlBuf.append(dialect.quote(objectName));
    log.info("Dropping", typeName, sqlBuf.toString());
    var statement = null;
    try {
        conn.setReadOnly(false);
        statement = conn.createStatement();
        statement.execute(sqlBuf.toString());
    } finally {
        close(statement);
        close(conn);
    }
    return;
}