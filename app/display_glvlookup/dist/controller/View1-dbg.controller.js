sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/export/Spreadsheet",
    "sap/ui/export/library"
], (Controller, JSONModel, MessageBox, MessageToast, Spreadsheet, exportLibrary) => {
    "use strict";
    var EdmType = exportLibrary.EdmType;

    return Controller.extend("displayglvlookup.controller.View1", {
        onInit() {
            var oTableModel = new JSONModel({
                data: []
            });
   
            this.getView().setModel(oTableModel, "tableModel");
        },

        onDisplayGLData: async function () {

            try {

                const oModel = this.getOwnerComponent().getModel();

                const oAction = oModel.bindContext(
                    "/displayGLData(...)",
                    null,
                    {
                        $$groupId: "$direct"
                    }
                );

                await oAction.execute();

                const aResult = oAction.getBoundContext().getObject();

                console.log(aResult);

                const aData = aResult.value || aResult;

                const aTableData = aData.map(function (row) {

                    return {
                        "Company Code": row.COMPANY_CODE,
                        "Payment Type": row.PAYMENT_TYPE,
                        "Payment Sub Type": row.PAYMENT_SUB_TYPE,
                        "Host": row.HOST_NAME,
                        "transaction_amount": row.TXN_AMOUNT,
                        "host_mdr_amount": row.HOST_MDR_AMOUNT,
                        "host_fee_payable": row.HOST_FEE_PAYABLE,
                        "mobi_mdr_amount": row.MOBI_MDR_AMOUNT,
                        "mdr_revenue": row.MDR_REVENUE,
                        "GL Accounts": row.GL_Accounts,
                        "Status": row.Status
                    };

                });

                this.getView().getModel("tableModel").setData({
                    data: aTableData
                });
                // Calculate counts
                var iTotal = aTableData.length;

                var iActive = aTableData.filter(function (oRow) {
                    return oRow.Status === "A";
                }).length;

                var iInactive = aTableData.filter(function (oRow) {
                    return oRow.Status === "I";
                }).length;

                // Display summary
                this.byId("msgCount").setText(
                    "Total Records : " + iTotal + "\n" +
                    "Active Records : " + iActive + "\n" +
                    "Inactive Records : " + iInactive
                );

                this.byId("msgCount").setVisible(true);

            } catch (e) {

                console.error(e);
                MessageBox.error("Unable to fetch GL Data");

            }

        },
        onDownloadData: function () {

            var aData = this.getView().getModel("tableModel").getProperty("/data");

            if (!aData || aData.length === 0) {
                MessageToast.show("No data available to download.");
                return;
            }

            var aColumns = [
                {
                    label: "Company Code",
                    property: "Company Code",
                    type: EdmType.String
                },
                {
                    label: "Payment Type",
                    property: "Payment Type",
                    type: EdmType.String
                },
                {
                    label: "Payment Sub Type",
                    property: "Payment Sub Type",
                    type: EdmType.String
                },
                {
                    label: "Host",
                    property: "Host",
                    type: EdmType.String
                },
                {
                    label: "Transaction Amount",
                    property: "transaction_amount",
                    type: EdmType.String
                },
                {
                    label: "Host MDR Amount",
                    property: "host_mdr_amount",
                    type: EdmType.String
                },
                {
                    label: "Host Fee Payable",
                    property: "host_fee_payable",
                    type: EdmType.String
                },
                {
                    label: "Mobi MDR Amount",
                    property: "mobi_mdr_amount",
                    type: EdmType.String
                },
                {
                    label: "MDR Revenue",
                    property: "mdr_revenue",
                    type: EdmType.String
                },
                {
                    label: "GL Accounts",
                    property: "GL Accounts",
                    type: EdmType.String
                },
                {
                    label: "Status",
                    property: "Status",
                    type: EdmType.String
                }
            ];

            var oSettings = {
                workbook: {
                    columns: aColumns
                },
                dataSource: aData,
                fileName: "GL_Accounts.xlsx",
                worker: false
            };

            var oSpreadsheet = new Spreadsheet(oSettings);

            oSpreadsheet.build()
                .then(function () {
                    MessageToast.show("Download completed.");
                })
                .finally(function () {
                    oSpreadsheet.destroy();
                });

        }
    });
});